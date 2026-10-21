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
test("one near Agent reserves a sequence for one request even across adapters", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-near-sequence-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), id = "ssh_" + crypto.randomUUID(), agent = { identity: { deviceId: crypto.randomUUID() }, file: name => path.join(dir, name), registry: () => ({ [deviceId]: {} }) };
  const first = new NearSessions(agent); first.register({ id, deviceId, server: "fixed" });
  const input = { requestId: crypto.randomUUID(), sequence: 1, requestHash: "a".repeat(64) };
  first.registerRequest(id, input);
  const second = new NearSessions(agent); second.registerRequest(id, input);
  assert.throws(() => second.registerRequest(id, { ...input, requestId: crypto.randomUUID() }), { code: "REQUEST_CONFLICT" });
  assert.equal(second.requests(id).requests.length, 1);
});
test("near metadata retains one close slot after all command slots are occupied", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-near-close-capacity-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), id = "ssh_" + crypto.randomUUID(), agent = { identity: { deviceId: crypto.randomUUID() }, file: name => path.join(dir, name), registry: () => ({ [deviceId]: {} }) };
  const service = new NearSessions(agent); service.register({ id, deviceId, server: "fixed" });
  const requestDir = path.join(service.directory(id), "requests"), realReadDir = fs.readdirSync;
  t.mock.method(fs, "readdirSync", function (file, ...args) { return String(file) === requestDir ? Array(10000).fill("retained.json") : realReadDir.call(fs, file, ...args); });
  const result = service.registerRequest(id, { requestId: crypto.randomUUID(), kind: "close", requestHash: "b".repeat(64) });
  assert.equal(result.kind, "close");
});
