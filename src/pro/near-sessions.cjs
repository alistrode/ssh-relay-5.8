"use strict";
const fs = require("node:fs"), path = require("node:path");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
const { agentControl } = require("./agent-control.cjs");
const { validateTaskPage, publicFailure } = require("./task-result.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
function sessionKey(id) {
  if (typeof id !== "string" || !id.startsWith("ssh_")) throw failure("SESSION_INVALID", "A stable ssh_ session ID is required");
  operationId(id.slice(4)); return id;
}
class NearSessions {
  constructor(agent, { control = agentControl } = {}) { this.agent = agent; this.control = control; this.dir = folder(agent.file("sessions")); }
  directory(id) { return path.join(this.dir, sessionKey(id)); }
  file(id) { return path.join(this.directory(id), "manifest.json"); }
  record(id) {
    const record = privateJSON(this.file(id), null);
    if (!record) throw failure("SESSION_NOT_FOUND", "Unknown remembered session");
    if (record.id !== id || record.profileId !== this.agent.identity.deviceId || record.remoteSessionId !== id.slice(4) ||
        !Number.isFinite(record.createdAt) || typeof record.server !== "string" || !record.server)
      throw failure("SESSION_CORRUPT", "Remembered session identity is invalid");
    operationId(record.deviceId); return record;
  }
  public(record) { const { profileId, ...value } = record; return value; }
  register(params) {
    const id = sessionKey(params.id), deviceId = operationId(params.deviceId);
    if (!this.agent.registry()[deviceId]) throw failure("DEVICE_NOT_FOUND", "Unknown paired device");
    if (typeof params.server !== "string" || !params.server || params.server.length > 128 ||
        (params.platform !== undefined && !["linux", "windows"].includes(params.platform)) ||
        (params.name !== undefined && (typeof params.name !== "string" || params.name.length > 256)))
      throw failure("SESSION_INVALID", "Invalid session display metadata");
    if (fs.existsSync(this.file(id))) {
      const record = this.record(id);
      if (record.deviceId !== deviceId || record.server !== params.server) throw failure("REQUEST_CONFLICT", "Session ID belongs to another fixed target");
      return this.public(record);
    }
    if (fs.readdirSync(this.dir).length >= 10000) throw failure("SESSION_CAPACITY", "Remembered session capacity reached");
    folder(this.directory(id)); folder(path.join(this.directory(id), "requests"));
    const record = { id, remoteSessionId: id.slice(4), deviceId, server: params.server, name: params.name || params.server,
      platform: params.platform || "unknown",
      profileId: this.agent.identity.deviceId, createdAt: Date.now(), state: "registered" };
    durableWrite(this.file(id), record); return this.public(record);
  }
  list() {
    const sessions = [];
    for (const id of fs.readdirSync(this.dir)) {
      if (!/^ssh_[a-f0-9-]{36}$/.test(id)) continue;
      try { sessions.push(this.public(this.record(id))); } catch { sessions.push({ id, state: "unknown", errorCode: "SESSION_CORRUPT" }); }
    }
    return { sessions: sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100) };
  }
  registerRequest(id, params) {
    this.record(id); const requestId = operationId(params.requestId), kind = params.kind || "send";
    if (!["send", "close"].includes(kind) || !/^[a-f0-9]{64}$/.test(params.requestHash) ||
        (kind === "send" && (!Number.isInteger(params.sequence) || params.sequence < 1 || params.sequence > 10000)))
      throw failure("SESSION_INVALID", "Invalid session request metadata");
    const file = path.join(this.directory(id), "requests", requestId + ".json");
    const record = { requestId, kind, sequence: kind === "send" ? params.sequence : null, requestHash: params.requestHash };
    const previous = privateJSON(file, null);
    if (previous) {
      if (previous.requestId !== requestId || previous.kind !== record.kind || previous.sequence !== record.sequence || previous.requestHash !== record.requestHash)
        throw failure("REQUEST_CONFLICT", "Session request ID was used for different input");
    } else {
      if (fs.readdirSync(path.dirname(file)).length >= 10000) throw failure("SESSION_CAPACITY", "Session request metadata capacity reached");
      durableWrite(file, { ...record, createdAt: Date.now() });
    }
    return { id, requestId, kind, sequence: record.sequence };
  }
  requests(id) {
    this.record(id); const result = [];
    for (const name of fs.readdirSync(path.join(this.directory(id), "requests"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const value = privateJSON(path.join(this.directory(id), "requests", name), null);
      if (!value || value.requestId !== name.slice(0, -5)) throw failure("SESSION_CORRUPT", "Session request metadata is invalid");
      const { requestHash, ...record } = value; result.push(record);
    }
    return { id, requests: result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100) };
  }
  async get(id, params = {}) {
    const record = this.record(id);
    try {
      const control = await this.control(this.agent, record.deviceId);
      const requestId = params.requestId === undefined ? null : operationId(params.requestId);
      const request = requestId ? privateJSON(path.join(this.directory(id), "requests", requestId + ".json"), null) : null;
      if (requestId && !request)
        throw failure("SESSION_REQUEST_NOT_FOUND", "Unknown remembered session request");
      const value = await control.request(requestId ? "session.get" : "session.status", { ...params, sessionId: record.remoteSessionId });
      if (!value || value.sessionId !== record.remoteSessionId || value.deviceId !== record.deviceId || (requestId && value.requestId !== requestId))
        throw failure("CONTROL_RESULT_INVALID", "Remote session response identity is invalid");
      if (requestId && value.stdout && value.stderr) validateTaskPage({ ...value, operationId: requestId },
        { ...params, operationId: requestId, deviceId: record.deviceId });
      if (requestId && (!["submitted", "pending", "accepted", "running", "completed", "failed", "unknown", "lost"].includes(value.state) ||
          typeof value.completed !== "boolean" ||
          (request.kind === "send" && ["completed", "failed"].includes(value.state) !== value.completed) ||
          (value.completed && !(request.kind === "close" && value.state === "lost" && value.stopRequested === true) &&
            (!value.result || !value.stdout || !value.stderr || !["completed", "failed"].includes(value.state)))))
        throw failure("CONTROL_RESULT_INVALID", "Remote session completion metadata is invalid");
      if (!requestId && !["starting", "open", "busy", "unknown", "lost", "closed"].includes(value.state))
        throw failure("CONTROL_RESULT_INVALID", "Remote session state is invalid");
      if (!requestId) { record.state = value.state; record.observedAt = Date.now(); durableWrite(this.file(id), record); }
      return { ...this.public(record), ...value, id, remoteSessionId: record.remoteSessionId };
    } catch (error) { return { ...this.public(record), id, deviceId: record.deviceId, remoteSessionId: record.remoteSessionId,
      requestId: params.requestId, state: "unknown", completed: false, error: publicFailure(error) }; }
  }
}
module.exports = { NearSessions, sessionKey };
