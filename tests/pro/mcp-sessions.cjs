"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { normalizeSessionRequest } = require("../../src/pro/session-spec.cjs");
async function fixture() {
  const context = vm.createContext({ Buffer, setTimeout, clearTimeout });
  const records = new Map(), requests = new Map(), map = new Map(), calls = [];
  const deviceId = crypto.randomUUID(), config = { name: "fixed", agentDeviceId: deviceId, platform: "linux", capabilities: { sessionResume: true, sessionProtocol: 1 } };
  let pending = false, failCreate = false;
  const agent = {
    registerSession: async value => { records.set(value.id, { ...value, remoteSessionId: value.id.slice(4), createdAt: Date.now() }); },
    sessions: async () => ({ sessions: [...records.values()] }),
    sessionRequests: async id => ({ requests: requests.get(id) || [] }),
    registerSessionRequest: async (id, value) => { requests.set(id, [...(requests.get(id) || []), { ...value, createdAt: Date.now() }]); },
    session: async (id, params = {}) => params.requestId ? { ...records.get(id), state: pending ? "unknown" : "completed", completed: !pending,
      result: pending ? null : { exitCode: 0 }, ...(requests.get(id)?.some(r => r.requestId === params.requestId && r.kind === "close") ? { stopRequested: true } : {}) }
      : { ...records.get(id), state: "open", nextSequence: 1, platform: "linux", cwd: "/tmp" },
  };
  const control = { capabilities: config.capabilities, channel: { closed: () => false }, request: async (method, value) => {
    calls.push(method); if (failCreate && method === "session.create") throw Error("lost acknowledgement");
    return { sessionId: value.sessionId, deviceId };
  } };
  const conn = { config, client: {} };
  const legacy = { sessions: map, sessionInfo: s => ({ id: s.id, server: s.server }),
    startSession: async () => { calls.push("legacy.start"); const id = "legacy"; map.set(id, { id, server: "fixed", history: [] }); return { id }; },
    sendSession: async () => ({ stdout: "legacy", code: 0, success: true }),
    closeSession: id => { calls.push("legacy.close"); map.delete(id); return { id, closed: true }; } };
  const modules = {
    "node:crypto": { default: crypto },
    "node:module": { createRequire: () => name => name.includes("agent-control") ? { openControl: async () => control } :
      name.includes("session-spec") ? { normalizeSessionRequest } : { executeSessionCommand: async (ctl, sdk, input) => {
        calls.push("execute"); await sdk.registerSessionRequest(input.id, { requestId: input.requestId, sequence: input.sequence, kind: "send" });
        return { success: true, completed: true, state: "completed", stdout: "ok", code: 0, session: input.id, requestId: input.requestId, cwd: "/tmp" };
      } } },
    "./transport.js": { connect: async () => conn },
    "./config.js": { agentMode: true, localAgentClient: async () => agent, serverConfig: () => config },
    "./legacy-sessions.js": legacy,
  };
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/mcp/sessions.js"), "utf8");
  const module = new vm.SourceTextModule(source, { context, initializeImportMeta: meta => { meta.url = "file:///fixture/sessions.js"; } });
  await module.link(async name => { const values = modules[name]; if (!values) throw Error(name);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
  await module.evaluate();
  return { api: module.namespace, calls, config, records, requests, map, pending: () => { pending = true; }, failCreate: () => { failCreate = true; } };
}
const options = { skip: !vm.SourceTextModule };
test("MCP detach keeps persistent shells, restores IDs, and refuses unresolved command replay", options, async () => {
  const f = await fixture(), started = await f.api.startSession("fixed", "label");
  assert.equal(started.persistent, true); assert.equal(started.state, "ready");
  const result = await f.api.sendSession(started.id, "echo ok", 1000);
  assert.equal(result.stdout, "ok"); assert.equal(f.calls.filter(v => v === "execute").length, 1);
  f.api.closeSessions(); assert.equal(f.calls.includes("session.close"), false);
  assert.equal(f.map.size, 0); await f.api.listSessions(); assert.equal(f.map.has(started.id), true);
  f.pending(); const blocked = await f.api.sendSession(started.id, "echo ok", 1000);
  assert.equal(blocked.errorCode, "SESSION_PREVIOUS_REQUEST_UNRESOLVED");
  assert.equal(f.calls.filter(v => v === "execute").length, 1);
});
test("lost create acknowledgement returns stable ID without replay or legacy fallback", options, async () => {
  const f = await fixture(); f.failCreate(); const result = await f.api.startSession("fixed");
  assert.equal(result.state, "unknown"); assert.equal(f.records.has(result.id), true);
  assert.equal(f.calls.filter(v => v === "session.create").length, 1); assert.equal(f.calls.includes("legacy.start"), false);
});
test("legacy session retains original shutdown behavior and explicit recovery limit", options, async () => {
  const f = await fixture(); f.config.capabilities.sessionResume = false;
  const result = await f.api.startSession("fixed"); assert.equal(result.persistent, false);
  f.api.closeSessions(); assert.equal(f.calls.filter(v => v === "legacy.close").length, 1);
});
