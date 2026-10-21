"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { executeSessionCommand } = require("../../src/pro/session-call.cjs");
function request() { const remoteSessionId = crypto.randomUUID(); return { remoteSessionId, id: "ssh_" + remoteSessionId, deviceId: crypto.randomUUID(), requestId: crypto.randomUUID(), sequence: 1, spec: { command: "echo ok", timeoutMs: 1000 }, platform: "linux" }; }
test("session command intent precedes a single submit and polling never resubmits", async () => {
  const r = request(), calls = []; let queries = 0;
  const agent = { registerSessionRequest: async () => { calls.push("register"); }, session: async () => {
    calls.push("get"); queries++;
    if (queries === 1) return { sessionId: r.remoteSessionId, deviceId: r.deviceId, requestId: r.requestId, state: "pending", completed: false };
    return { sessionId: r.remoteSessionId, deviceId: r.deviceId, requestId: r.requestId, state: "completed", completed: true,
      result: { exitCode: 0, cwd: "/tmp" }, outputEncoding: "base64", stdout: { data: Buffer.from("中文").toString("base64"), nextOffset: 6, storedBytes: 6 }, stderr: { data: "", nextOffset: 0, storedBytes: 0 } };
  } };
  const control = { request: async method => { calls.push(method); return { sessionId: r.remoteSessionId, deviceId: r.deviceId, requestId: r.requestId }; } };
  const result = await executeSessionCommand(control, agent, r, { sleep: async () => {} });
  assert.equal(result.success, true); assert.equal(result.stdout, "中文"); assert.equal(result.cwd, "/tmp");
  assert.equal(calls[0], "register"); assert.equal(calls.filter(method => method === "session.send").length, 1);
});
test("lost command acknowledgement retains request IDs and never retries", async () => {
  const r = request(); let sends = 0, gets = 0;
  const result = await executeSessionCommand({ request: async () => { sends++; throw Error("lost"); } },
    { registerSessionRequest: async () => {}, session: async () => { gets++; } }, r);
  assert.equal(result.state, "unknown"); assert.equal(result.requestId, r.requestId); assert.equal(result.session, r.id);
  assert.equal(sends, 1); assert.equal(gets, 0);
});
