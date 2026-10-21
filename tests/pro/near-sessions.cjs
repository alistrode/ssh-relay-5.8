"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { NearSessions } = require("../../src/pro/near-sessions.cjs");
test("remembered sessions and request IDs survive adapters without dispatching commands", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-near-session-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), remoteSessionId = crypto.randomUUID(), id = "ssh_" + remoteSessionId, requestId = crypto.randomUUID();
  const agent = { identity: { deviceId: crypto.randomUUID() }, file: name => path.join(dir, name), registry: () => ({ [deviceId]: {} }) };
  const calls = []; let wrong = false, missing = false;
  const options = { control: async () => ({ request: async (method, params) => {
    calls.push(method);
    return { sessionId: remoteSessionId, deviceId: wrong ? crypto.randomUUID() : deviceId, requestId: params.requestId,
      state: "completed", completed: true, outputEncoding: "base64", ...(missing ? {} : { result: { exitCode: 0 },
        stdout: { data: "", nextOffset: 0, storedBytes: 0 }, stderr: { data: "", nextOffset: 0, storedBytes: 0 } }) };
  } }) };
  const service = new NearSessions(agent, options);
  service.register({ id, deviceId, server: "fixed-device" });
  service.registerRequest(id, { requestId, sequence: 1, requestHash: "a".repeat(64) });
  assert.equal(calls.length, 0);
  const reopened = new NearSessions(agent, options);
  assert.equal(reopened.requests(id).requests[0].requestId, requestId);
  assert.equal(JSON.stringify(reopened.requests(id)).includes("requestHash"), false);
  assert.equal((await reopened.get(id, { requestId })).completed, true);
  wrong = true;
  assert.equal((await reopened.get(id, { requestId })).error.code, "CONTROL_RESULT_INVALID");
  wrong = false; missing = true;
  assert.equal((await reopened.get(id, { requestId })).state, "unknown");
  assert.equal(calls.every(method => method === "session.get"), true);
});
