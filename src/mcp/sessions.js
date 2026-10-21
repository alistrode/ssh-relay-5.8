import crypto from "node:crypto";
import { createRequire } from "node:module";
import { connect } from "./transport.js";
import { agentMode, localAgentClient, serverConfig } from "./config.js";
import * as legacy from "./legacy-sessions.js";
const require = createRequire(import.meta.url);
const { openControl } = require("../pro/agent-control.cjs");
const { executeSessionCommand } = require("../pro/session-call.cjs");
const { normalizeSessionRequest } = require("../pro/session-spec.cjs");
export const sessions = legacy.sessions;
const controls = new WeakMap();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function controlFor(session) {
  const config = serverConfig(session.server);
  if (config.agentDeviceId !== session.deviceId) throw Object.assign(Error("Remembered session target identity changed"), { code: "SESSION_TARGET_CHANGED" });
  const conn = await connect(session.server);
  if (conn.config.agentDeviceId !== session.deviceId) throw Object.assign(Error("Session connection target identity changed"), { code: "SESSION_TARGET_CHANGED" });
  let control = controls.get(conn);
  if (!control || control.channel.closed()) { control = await openControl(conn.client, session.deviceId); controls.set(conn, control); }
  if (control.capabilities.sessionProtocol !== 1 || !control.capabilities.sessionResume)
    throw Object.assign(Error("Original target does not support recoverable sessions"), { code: "SESSION_UNSUPPORTED" });
  return control;
}
function applyStatus(session, value) {
  if (["linux", "windows"].includes(value.platform)) {
    if (["linux", "windows"].includes(session.platform) && session.platform !== value.platform) {
      session.state = "unknown"; session.errorCode = "SESSION_PLATFORM_CHANGED"; return;
    }
    session.platform = value.platform;
  }
  session.state = value.state === "open" ? "ready" : value.state;
  session.cwd = value.cwd ?? session.cwd; session.nextSequence = value.nextSequence;
  session.errorCode = value.error?.code || value.errorCode; session.lastActivity = Date.now();
}
export function sessionInfo(session) {
  if (!session.persistent) return { ...legacy.sessionInfo(session), persistent: false, recovery: "legacy-ssh-channel" };
  return { id: session.id, server: session.server, name: session.name, state: session.state, cwd: session.cwd,
    createdAt: session.createdAt, lastActivity: session.lastActivity, historyCount: session.history?.length || 0,
    platform: session.platform, persistent: true, lastRequestId: session.lastRequestId, errorCode: session.errorCode };
}
export async function listSessions() {
  if (agentMode) {
    const records = await (await localAgentClient()).sessions();
    for (const record of records.sessions) if (!sessions.has(record.id)) sessions.set(record.id, {
      ...record, persistent: true, state: "unknown", lastKnownState: record.state,
      createdAt: new Date(record.createdAt).toISOString(), lastActivity: record.createdAt, history: [], cwd: null,
    });
  }
  return [...sessions.values()].map(sessionInfo);
}
export async function getSession(id) {
  if (!sessions.has(id) && agentMode) await listSessions();
  const session = sessions.get(id); if (!session) throw Error("Unknown session"); return session;
}
export async function startSession(name, label) {
  const conn = await connect(name), config = conn.config;
  if (!config.agentDeviceId || config.capabilities?.sessionProtocol !== 1 || !config.capabilities?.sessionResume)
    return { ...(await legacy.startSession(name, label)), persistent: false, recovery: "legacy-ssh-channel" };
  const remoteSessionId = crypto.randomUUID(), id = "ssh_" + remoteSessionId, agent = await localAgentClient();
  await agent.registerSession({ id, deviceId: config.agentDeviceId, server: config.name, name: label || name, platform: config.platform });
  const session = { id, remoteSessionId, deviceId: config.agentDeviceId, server: config.name, name: label || name,
    persistent: true, platform: config.platform, state: "starting", createdAt: new Date().toISOString(), lastActivity: Date.now(), history: [], cwd: null };
  sessions.set(id, session);
  try {
    const control = await controlFor(session);
    const started = await control.request("session.create", { sessionId: remoteSessionId, cwd: config.defaultDir || null });
    if (started.sessionId !== remoteSessionId || started.deviceId !== session.deviceId) throw Error("Session startup target differs");
    const deadline = Date.now() + 15000;
    do {
      const status = await agent.session(id); applyStatus(session, status);
      if (status.state !== "starting") break;
      await sleep(250);
    } while (Date.now() < deadline);
  } catch (error) { session.state = "unknown"; session.errorCode = error.code || "CONTROL_UNAVAILABLE"; }
  return { ...sessionInfo(session), success: session.state === "ready" };
}
export async function sendSession(id, command, timeout = 30000, record = true) {
  const session = await getSession(id);
  if (!session.persistent) return { ...(await legacy.sendSession(id, command, timeout, record)), persistent: false, recovery: "legacy-ssh-channel" };
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000) throw Error("Timeout must be 1..300000 ms");
  const agent = await localAgentClient(), status = await agent.session(id); applyStatus(session, status);
  if (session.state !== "ready") return { success: false, session: id, state: session.state, persistent: true,
    completed: false, requestId: session.lastRequestId, errorCode: status.error?.code || "SESSION_UNAVAILABLE" };
  const requests = (await agent.sessionRequests(id)).requests;
  const latest = requests.find(value => value.kind === "close") ||
    requests.sort((a, b) => (b.createdAt - a.createdAt) || ((b.sequence || 0) - (a.sequence || 0)))[0];
  if (latest) {
    const previous = await agent.session(id, { requestId: latest.requestId });
    if (!previous.completed || latest.kind === "close") return { success: false, session: id, requestId: latest.requestId,
      persistent: true, completed: false, state: "unknown", errorCode: "SESSION_PREVIOUS_REQUEST_UNRESOLVED" };
  }
  const control = await controlFor(session), requestId = crypto.randomUUID();
  session.lastRequestId = requestId; session.state = "busy";
  if (record) session.history.push({ command, timestamp: new Date().toISOString() });
  const result = await executeSessionCommand(control, agent, { id, deviceId: session.deviceId,
    remoteSessionId: session.remoteSessionId, requestId, sequence: status.nextSequence,
    spec: { command, timeoutMs: timeout }, platform: session.platform });
  session.state = result.completed ? "ready" : "unknown"; session.cwd = result.cwd ?? session.cwd;
  session.lastActivity = Date.now(); return result;
}
export async function closeSession(id) {
  const session = await getSession(id);
  if (!session.persistent) return legacy.closeSession(id);
  const agent = await localAgentClient(), status = await agent.session(id);
  if (["lost", "closed"].includes(status.state)) { sessions.delete(id); return { id, closed: true, state: "lost", persistent: true }; }
  const previous = (await agent.sessionRequests(id)).requests.find(value => value.kind === "close");
  if (previous) {
    const result = await agent.session(id, { requestId: previous.requestId });
    if (result.completed && result.stopRequested) { sessions.delete(id); return { id, closed: true, state: "lost", persistent: true, stopRequested: true, requestId: previous.requestId }; }
    return { id, closed: false, state: "unknown", persistent: true, requestId: previous.requestId };
  }
  const requestId = crypto.randomUUID(), request = normalizeSessionRequest({ sessionId: session.remoteSessionId, requestId, method: "close" }, session.platform);
  try {
    await agent.registerSessionRequest(id, { requestId, requestHash: request.requestHash, kind: "close" });
    await (await controlFor(session)).request("session.close", { sessionId: session.remoteSessionId, requestId });
    const deadline = Date.now() + 5000;
    do {
      const value = await agent.session(id, { requestId });
      if (value.completed && value.stopRequested) { sessions.delete(id); return { id, closed: true, state: "lost", persistent: true, stopRequested: true, requestId }; }
      if (value.state === "unknown") break;
      await sleep(100);
    } while (Date.now() < deadline);
  } catch {}
  session.state = "unknown"; session.lastRequestId = requestId;
  return { id, closed: false, state: "unknown", persistent: true, requestId };
}
export function closeSessions() {
  for (const [id, session] of sessions) {
    if (session.persistent) sessions.delete(id);
    else legacy.closeSession(id);
  }
}
