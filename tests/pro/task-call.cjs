"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { executeTask } = require("../../src/pro/task-call.cjs");
const deviceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function fixture() {
  const request = { operationId: crypto.randomUUID(), kind: "exec", spec: {}, requestHash: "a".repeat(64) };
  const options = { parentOperationId: crypto.randomUUID(), deviceId, timeout: 1000, sleep: async () => {} };
  return { request, options };
}
function page(request, data, offset, stored, state = "running") {
  return { operationId: request.operationId, deviceId, state, outputEncoding: "base64",
    stdout: { data: data.toString("base64"), nextOffset: offset + data.length, storedBytes: stored },
    stderr: { data: "", nextOffset: 0, storedBytes: 0 },
    result: state === "completed" ? { exitCode: 0, stdout: { truncated: false }, stderr: { truncated: false } } : null };
}
test("one submit followed only by get preserves UTF-8 across byte pages", async () => {
  const { request, options } = fixture(), bytes = Buffer.from("汉A"), calls = [];
  const control = { request: async (method, params) => {
    calls.push({ method, params });
    return method === "submit" ? page(request, bytes.subarray(0, 2), 0, 4)
      : page(request, bytes.subarray(2), 2, 4, "completed");
  } };
  const result = await executeTask(control, request, options);
  assert.equal(result.stdout, "汉A");
  assert.equal(result.success, true);
  assert.equal(result.operationId, options.parentOperationId);
  assert.deepEqual(calls.map(call => call.method), ["submit", "get"]);
  assert.equal(calls[1].params.stdoutOffset, 2);
});
test("lost submit acknowledgement returns the saved IDs without replay", async () => {
  const { request, options } = fixture();
  let effects = 0;
  const result = await executeTask({ request: async method => {
    assert.equal(method, "submit"); effects++;
    throw Object.assign(Error("lost reply after accept"), { code: "CONTROL_CLOSED" });
  } }, request, options);
  assert.equal(effects, 1);
  assert.equal(result.state, "unknown");
  assert.equal(result.operationId, options.parentOperationId);
  assert.equal(result.childOperationId, request.operationId);
});
test("inline limit returns an exact resumable cursor without skipping unseen bytes", async () => {
  const { request, options } = fixture();
  const result = await executeTask({ request: async () => page(request, Buffer.from("abcdef"), 0, 6, "completed") },
    request, { ...options, captureBytes: 3 });
  assert.equal(result.errorCode, "OUTPUT_PAGINATION_REQUIRED");
  assert.equal(result.stdout, "abc");
  assert.equal(result.stdoutOffset, 3);
  assert.equal(result.completed, true);
});
test("wrong target response cannot produce a successful command result", async () => {
  const { request, options } = fixture();
  const result = await executeTask({ request: async () => ({
    ...page(request, Buffer.from("untrusted"), 0, 9, "completed"), deviceId: crypto.randomUUID(),
  }) }, request, options);
  assert.equal(result.success, false);
  assert.equal(result.stdout, "");
  assert.equal(result.errorCode, "CONTROL_RESULT_INVALID");
});
