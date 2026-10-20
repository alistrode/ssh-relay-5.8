"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Operations } = require("../../src/pro/operations.cjs");
const profileId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", deviceId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-parent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agent = { file: name => path.join(dir, name), identity: { deviceId: profileId },
    registry: () => ({ [deviceId]: { id: deviceId } }) };
  const input = { operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID(),
    deviceId, kind: "exec", requestHash: "a".repeat(64) };
  return { agent, input };
}
function page(input) {
  return { operationId: input.childOperationId, deviceId, state: "running", result: null,
    stdout: { data: "", nextOffset: 0, storedBytes: 0 },
    stderr: { data: "", nextOffset: 0, storedBytes: 0 }, outputEncoding: "base64" };
}
test("parent registration never submits; a fresh adapter queries the saved child ID", async t => {
  const { agent, input } = fixture(t), calls = [];
  const control = async () => ({ request: async (method, params) => {
    calls.push({ method, params }); return page(input);
  } });
  const first = new Operations(agent, { control });
  first.register(input); first.register(input);
  assert.equal(calls.length, 0);
  assert.throws(() => first.register({ ...input, requestHash: "b".repeat(64) }), { code: "REQUEST_CONFLICT" });
  const recovered = new Operations(agent, { control });
  const result = await recovered.get(input.operationId);
  assert.equal(result.operationId, input.operationId);
  assert.equal(result.childOperationId, input.childOperationId);
  assert.deepEqual(calls.map(call => call.method), ["get"]);
  assert.equal(calls[0].params.operationId, input.childOperationId);
  assert.equal(JSON.stringify(recovered.list()).includes(input.requestHash), false);
});
test("lost replies never cause submit, wrong target/cursor responses are rejected", async t => {
  const { agent, input } = fixture(t);
  const service = new Operations(agent, { control: async () => ({ request: async method => {
    assert.equal(method, "get");
    throw Object.assign(Error("closed"), { code: "CONTROL_CLOSED", retryable: true });
  } }) });
  service.register(input);
  assert.equal((await service.get(input.operationId)).state, "unavailable");
  service.control = async () => ({ request: async () => ({ ...page(input), deviceId: profileId }) });
  const result = await service.get(input.operationId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CONTROL_RESULT_INVALID");
});
test("cancellation retains the original request ID across uncertain replies", async t => {
  const { agent, input } = fixture(t), seen = [];
  const service = new Operations(agent, { control: async () => ({ request: async (method, params) => {
    assert.equal(method, "cancel"); seen.push(params.requestId);
    return { operationId: input.childOperationId, state: "cancel_requested" };
  } }) });
  service.register(input);
  const first = crypto.randomUUID();
  await service.cancel(input.operationId, { requestId: first });
  await service.cancel(input.operationId, { requestId: crypto.randomUUID() });
  assert.deepEqual(seen, [first, first]);
});
