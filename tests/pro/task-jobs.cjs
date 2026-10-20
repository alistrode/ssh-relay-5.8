"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { jobHash, jobCatalog, jobFile } = require("../../src/pro/task-jobs.cjs");
const { normalizeJobSpec, requestHash } = require("../../src/pro/task-spec.cjs");
const { TaskManager } = require("../../src/pro/tasks.cjs");
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", deviceId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
test("controlled job hash ignores JSON key order but includes implementation and arguments", () => {
  const first = { name: "health", sourceHash: jobHash("health"), args: { interval: 2, duration: 1 } };
  const second = { ...first, args: { duration: 1, interval: 2 }, waitMs: 999 };
  assert.equal(requestHash(deviceId, "job", first), requestHash(deviceId, "job", second));
  assert.notEqual(requestHash(deviceId, "job", first),
    requestHash(deviceId, "job", { ...first, args: { duration: 2, interval: 2 } }));
  assert.throws(() => jobFile("../../unexpected"), { code: "UNSUPPORTED_JOB" });
  assert.throws(() => normalizeJobSpec({ ...first, args: { number: Infinity } }), { code: "INVALID_TASK_SPEC" });
});
test("module version mismatch rejects before spawn; accepted job IDs remain idempotent", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-job-registry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let starts = 0;
  const manager = new TaskManager({ dir, deviceId, bootId: crypto.randomUUID(), authorized: () => true,
    processIdentityProvider: () => ({ fixture: true }),
    spawn() { starts++; return Object.assign(new EventEmitter(), { unref() {} }); } });
  manager.space = () => {};
  const input = { operationId: crypto.randomUUID(), kind: "job",
    spec: { name: "health", sourceHash: "0".repeat(64), args: {} } };
  assert.throws(() => manager.submit(owner, input), { code: "JOB_VERSION_MISMATCH" });
  assert.equal(starts, 0);
  assert.equal(fs.readdirSync(dir).length, 0);
  input.spec.sourceHash = jobHash("health");
  manager.submit(owner, input);
  manager.identityAvailable = false;
  manager.submit(owner, input);
  assert.equal(starts, 1);
  assert.equal(Object.keys(jobCatalog()).length, 6);
});
