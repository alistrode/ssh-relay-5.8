"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeviceSlots } = require("../../src/pro/device-slots.cjs");

function devices(count) {
  return Object.fromEntries(Array.from({ length: count }, (_, n) =>
    ["device-" + n, { enabled: true, pairedAt: n + 1 }],
  ));
}

test("five offline saved devices reserve slots; reconnect is idempotent", () => {
  const slots = new DeviceSlots(), registry = devices(5);
  for (const key of Object.keys(registry))
    assert.doesNotThrow(() => slots.assertCanEnable(registry, key));
  assert.throws(() => slots.assertCanEnable(registry, "sixth"),
    { code: "DEVICE_SLOT_LIMIT" });
  registry["device-2"].enabled = false;
  assert.doesNotThrow(() => slots.assertCanEnable(registry, "sixth"));
  registry.sixth = { enabled: true, pairedAt: 6 };
  assert.equal(slots.snapshot(registry).active.length, 5);
  assert.throws(() => slots.assertCanEnable(registry, "device-2"),
    { code: "DEVICE_SLOT_LIMIT" });
});

test("legacy overflow is paused without deleting data and survives restart", () => {
  const registry = devices(7), before = JSON.stringify(registry);
  const expected = new DeviceSlots().snapshot(registry);
  assert.deepEqual(expected.paused, ["device-5", "device-6"]);
  assert.equal(JSON.stringify(registry), before);
  assert.deepEqual(new DeviceSlots().snapshot(JSON.parse(before)), expected);
  assert.throws(() => new DeviceSlots().assertCanEnable(registry, "device-5"),
    { code: "DEVICE_SLOT_LIMIT" });
  delete registry["device-1"];
  assert.deepEqual(new DeviceSlots().snapshot(registry).paused, ["device-6"]);
  assert.ok(registry["device-6"]);
});
