"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), os = require("node:os");
const health = require("../../src/mcp/jobs/health.cjs");
test("unavailable network enumeration is explicit and does not discard readable health metrics", async t => {
  t.mock.method(os, "networkInterfaces", () => { throw Object.assign(Error("denied"), { code: "EPERM" }); });
  const result = await health({});
  assert.equal(result.success, true); assert.equal(result.samples.length, 1);
  const sample = result.samples[0];
  assert.equal(sample.network, null); assert.equal(sample.networkError, "NETWORK_INTERFACES_UNAVAILABLE");
  assert.ok(Number.isFinite(sample.memory.total) && sample.memory.total > 0);
  assert.ok(Number.isFinite(sample.cpuPercent)); assert.deepEqual(sample.disk, []);
});
