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
test("corrupt recursive group metadata is rejected before querying children", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-group-corrupt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID();
  const agent = { identity: { deviceId: crypto.randomUUID() }, file: name => path.join(dir, name), registry: () => ({ [deviceId]: {} }) };
  const service = new Operations(agent);
  const input = { kind: "exec-group", operationId: crypto.randomUUID(), requestHash: "b".repeat(64),
    children: [{ operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID(), deviceId, requestHash: "a".repeat(64) }] };
  service.register(input);
  assert.throws(() => service.register({ ...input.children[0], kind: "exec", groupOperationId: crypto.randomUUID() }), { code: "REQUEST_CONFLICT" });
  const file = service.groups.file(input.operationId), record = JSON.parse(fs.readFileSync(file, "utf8"));
  record.children[0].operationId = input.operationId;
  fs.writeFileSync(file, JSON.stringify(record));
  assert.throws(() => service.groups.record(input.operationId), { code: "OPERATION_CORRUPT" });
});
test("group registration cannot capture an unrelated child and cancellation checks persisted ownership", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-group-ownership-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(); let calls = 0;
  const service = new Operations({ identity: { deviceId: crypto.randomUUID() }, file: n => path.join(dir, n),
    registry: () => ({ [deviceId]: {} }) }, { control: async () => { calls++; throw Error("must not connect"); } });
  const child = { kind: "exec", operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID(), deviceId, requestHash: "a".repeat(64) };
  service.register(child);
  const input = { kind: "exec-group", operationId: crypto.randomUUID(), requestHash: "b".repeat(64), children: [child] };
  assert.throws(() => service.register(input), { code: "REQUEST_CONFLICT" });
  assert.equal(service.groups.exists(input.operationId), false);
  input.children = [{ ...child, operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID() }];
  service.register(input);
  const file = service.file(input.children[0].operationId), record = JSON.parse(fs.readFileSync(file, "utf8"));
  delete record.groupOperationId; fs.writeFileSync(file, JSON.stringify(record));
  const result = await service.cancel(input.operationId, { requestId: crypto.randomUUID() });
  assert.equal(result.results[0].errorCode, "OPERATION_CORRUPT");
  assert.equal(calls, 0);
  assert.equal(service.record(input.children[0].operationId).state, "registered");
});
test("registration and listing preserve expired groups and their recovery records", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-group-retention-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID();
  const service = new Operations({ identity: { deviceId: crypto.randomUUID() }, file: n => path.join(dir, n), registry: () => ({ [deviceId]: {} }) });
  const make = () => ({ kind: "exec-group", operationId: crypto.randomUUID(), requestHash: "b".repeat(64),
    children: [{ operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID(), deviceId, requestHash: "a".repeat(64) }] });
  const old = make(), active = make(); service.register(old); service.register(active);
  const expired = Date.now() - 8 * 86400000;
  const group = service.groups.record(old.operationId); group.state = "failed"; group.observedAt = expired;
  fs.writeFileSync(service.groups.file(old.operationId), JSON.stringify(group));
  const child = service.record(old.children[0].operationId); child.state = "not_started"; child.observedAt = expired;
  fs.writeFileSync(service.file(child.operationId), JSON.stringify(child));
  service.register(make());
  service.list();
  assert.equal(typeof service.cleanup, "undefined");
  assert.equal(service.groups.exists(old.operationId), true);
  assert.equal(service.exists(child.operationId), true);
  assert.equal(service.groups.exists(active.operationId), true);
  assert.equal(service.exists(active.children[0].operationId), true);
});
