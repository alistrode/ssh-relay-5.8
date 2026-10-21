"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Operations } = require("../../src/pro/operations.cjs");
test("group registration fixes per-device IDs and status never reruns completed hosts", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-group-parent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const devices = [crypto.randomUUID(), crypto.randomUUID()];
  const children = devices.map(deviceId => ({ deviceId, operationId: crypto.randomUUID(),
    childOperationId: crypto.randomUUID(), requestHash: "a".repeat(64) }));
  const agent = { identity: { deviceId: crypto.randomUUID() }, file: name => path.join(dir, name),
    registry: () => Object.fromEntries(devices.map(id => [id, { id }])) };
  const calls = [];
  const service = new Operations(agent, { control: async (agent, deviceId) => ({ request: async (method, params) => {
    calls.push({ method, deviceId, params });
    if (deviceId === devices[1]) throw Object.assign(Error("offline"), { code: "CONTROL_CLOSED", retryable: true });
    return { operationId: params.operationId, deviceId, state: "completed", outputEncoding: "base64",
      result: { exitCode: 0 }, stdout: { data: "", nextOffset: 0, storedBytes: 0 },
      stderr: { data: "", nextOffset: 0, storedBytes: 0 } };
  } }) });
  const input = { kind: "exec-group", operationId: crypto.randomUUID(), requestHash: "b".repeat(64), children };
  service.register(input); service.register(input);
  assert.equal(calls.length, 0);
  const result = await service.get(input.operationId);
  assert.equal(result.state, "unknown");
  assert.equal(result.results[0].state, "completed");
  assert.equal(result.results[1].state, "unavailable");
  assert.equal(calls.every(call => call.method === "get"), true);
  assert.throws(() => service.register({ ...input, children: children.slice().reverse() }), { code: "REQUEST_CONFLICT" });
  const listed = service.list().operations.find(record => record.operationId === input.operationId);
  assert.equal(listed.children[0].childOperationId, children[0].childOperationId);
});
