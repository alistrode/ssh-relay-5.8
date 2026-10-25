"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Connections } = require("../../src/pro/connections.cjs");
const { DeviceSlots } = require("../../src/pro/device-slots.cjs");
const deviceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-connections-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let devices = { [deviceId]: { id: deviceId, enabled: true, desiredConnected: true } };
  const target = { id: deviceId, generation: 0, intentGeneration: 0, state: "waiting" };
  const agent = {
    bootId: crypto.randomUUID(), stopping: false, settings: { enabled: true },
    file: name => path.join(dir, name), registry: () => structuredClone(devices),
    saveRegistry: value => { devices = structuredClone(value); },
    deviceSlots: new DeviceSlots(), targets: new Map([[deviceId, target]]),
    targetFor: () => target, tick() {}, stopWorker() {},
    invalidateTarget(value) { value.generation++; value.client = null; },
  };
  const service = new Connections(agent);
  return { agent, service, target };
}
test("same requestId reuses in-flight connect; changed input is rejected without pairing", async t => {
  const { agent, service } = fixture(t);
  let finish, joins = 0;
  agent.joinPair = async () => { joins++; return { deviceId }; };
  service.ensureReady = () => new Promise(resolve => { finish = resolve; });
  const requestId = crypto.randomUUID();
  await service.connect({ requestId, deviceId, waitMs: 0 });
  await service.connect({ requestId, deviceId, waitMs: 0 });
  await assert.rejects(service.connect({ requestId, code: "another-code", waitMs: 0 }),
    { code: "REQUEST_CONFLICT" });
  assert.equal(joins, 0);
  const pending = service.tasks.get(requestId).pending;
  finish({ fingerprint: "pin", hostname: "host", remoteUser: "user", platform: "linux" });
  await pending;
  assert.equal(service.get(requestId).state, "ready");
  assert.equal(Object.hasOwn(service.result(service.get(requestId)), "requestHash"), false);
});
test("restart reports unfinished connect as unknown without replaying pairing", async t => {
  const { agent, service } = fixture(t);
  agent.joinPair = async () => { throw Error("must not replay"); };
  const requestId = crypto.randomUUID();
  service.save({ connectionTaskId: requestId, bootId: "old-instance", state: "connecting",
    requestHash: crypto.createHash("sha256").update(JSON.stringify({ code: "private-code" })).digest("hex") });
  const result = await service.connect({ requestId, code: "private-code", waitMs: 0 });
  assert.equal(result.state, "unknown");
  assert.equal(JSON.stringify(result).includes("private-code"), false);
});
test("disconnect releases a slot, preserves pairing and cancels the old readiness intent", async t => {
  const { agent, service } = fixture(t);
  const waiting = service.ensureReady(deviceId);
  const rejection = assert.rejects(waiting, { code: "DEVICE_DISCONNECTED" });
  const requestId = crypto.randomUUID();
  const result = service.disconnect(deviceId, { requestId });
  const saved = agent.registry();
  assert.equal(saved[deviceId].enabled, false);
  assert.equal(saved[deviceId].desiredConnected, false);
  assert.equal(agent.deviceSlots.snapshot(saved).active.length, 0);
  assert.equal(service.disconnect(deviceId, { requestId }).state, result.state);
  await rejection;
});
test("pending pairing reservations count toward every enable entrance and release on failure", () => {
  const slots = new DeviceSlots(), devices = {};
  for (let n = 0; n < 4; n++) devices["device" + n] = { enabled: true, pairedAt: n };
  slots.reserve(devices, "pairing-request");
  assert.equal(slots.snapshot(devices).used, 5);
  assert.throws(() => slots.assertCanEnable(devices, "sixth"), { code: "DEVICE_LIMIT_REACHED" });
  slots.assertCanEnable(devices, "paired", "pairing-request");
  slots.release("pairing-request");
  slots.assertCanEnable(devices, "next");
});

test("remembered device reconnects after Agent restart and invitation expiry without pairing", async t => {
  const { agent, service } = fixture(t);
  agent.joinPair = async () => assert.fail("reconnect must never perform a pairing handshake");
  service.ensureReady = async id => {
    assert.equal(id, deviceId);
    return { fingerprint: "pin", hostname: "host", remoteUser: "user", platform: "linux" };
  };
  service.disconnect(deviceId, { requestId: crypto.randomUUID() });
  const restarted = new Connections(agent);
  restarted.ensureReady = service.ensureReady;
  agent.bootId = crypto.randomUUID();
  const originalNow = Date.now;
  Date.now = () => originalNow() + 2 * 86400000;
  try {
    const result = await restarted.connect({ requestId: crypto.randomUUID(), deviceId });
    assert.equal(result.state, "ready");
    assert.equal(agent.registry()[deviceId].desiredConnected, true);
  } finally { Date.now = originalNow; }
});
test("pairing failures retain their phase rather than being reported as reconnect failures", async t => {
  const { agent, service } = fixture(t);
  agent.joinPair = async () => { throw Object.assign(Error("Pairing handshake timed out"),
    { code: "PAIRING_TIMEOUT", phase: "pairing", retryable: true }); };
  const result = await service.connect({ requestId: crypto.randomUUID(), code: "test-code" });
  assert.equal(result.error.phase, "pairing");
  assert.equal(result.error.code, "PAIRING_TIMEOUT");
  assert.equal(result.error.retryable, true);
});
