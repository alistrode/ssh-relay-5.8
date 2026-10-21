"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { TaskManager } = require("../../src/pro/tasks.cjs");
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const deviceId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-tasks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let starts = 0;
  const options = { dir, deviceId, bootId: crypto.randomUUID(), authorized: () => true,
    processIdentityProvider: () => ({ fixture: true }),
    spawn() { starts++; return Object.assign(new EventEmitter(), { unref() {} }); } };
  const manager = new TaskManager(options);
  t.mock.method(fs, "statfsSync", () => { throw Error("Disk inspection forbidden"); });
  return { options, manager, starts: () => starts };
}
function input(operationId = crypto.randomUUID(), command = "fixture command") {
  return { operationId, kind: "exec", spec: { command } };
}
test("duplicate submit reuses operation and rejects changed input or another owner", t => {
  const { manager, starts } = fixture(t), request = input();
  manager.submit(owner, request);
  manager.submit(owner, request);
  assert.equal(starts(), 1);
  assert.throws(() => manager.submit(owner, input(request.operationId, "changed")), { code: "REQUEST_CONFLICT" });
  assert.throws(() => manager.get(other, { operationId: request.operationId }), { code: "OPERATION_NOT_FOUND" });
  assert.equal(JSON.stringify(manager.get(owner, request)).includes("fixture command"), false);
});
test("restart preserves the original runner startup window without respawning", t => {
  const { manager, starts, options } = fixture(t), request = input();
  manager.submit(owner, request);
  manager.close();
  const recovered = new TaskManager({ ...options, bootId: crypto.randomUUID() });
  recovered.tick();
  assert.equal(recovered.get(owner, request).state, "unknown");
  assert.equal(JSON.parse(fs.readFileSync(manager.file(request.operationId, "manifest.json"))).state, "starting");
  assert.equal(recovered.active.size, 1);
  assert.equal(starts(), 1);
  const record = recovered.records.get(request.operationId);
  record.launchAt = Date.now() - 31000; recovered.save(record);
  recovered.tick();
  assert.equal(recovered.get(owner, request).state, "unknown");
  assert.equal(recovered.active.size, 1);
  assert.equal(starts(), 1);
  fs.writeFileSync(recovered.file(request.operationId, "result.json"), JSON.stringify({ operationId: request.operationId,
    owner, state: "completed", exitCode: 0, signal: null, errorCode: null, finishedAt: Date.now() }));
  recovered.tick();
  assert.equal(recovered.get(owner, request).state, "completed");
  assert.equal(recovered.get(owner, request).errorCode, null);
});
test("cancel queued work before execution; output pagination is byte bounded", t => {
  const { manager, starts } = fixture(t);
  manager.submit(owner, input()); manager.submit(owner, input());
  const queued = input();
  assert.equal(manager.submit(owner, queued).state, "accepted");
  assert.equal(manager.cancel(owner, { operationId: queued.operationId, requestId: crypto.randomUUID() }).state, "cancelled");
  assert.equal(starts(), 2);
  const out = path.join(manager.directory(queued.operationId), "stdout.bin");
  fs.writeFileSync(out, Buffer.from("abcdef"));
  const page = manager.get(owner, { operationId: queued.operationId, stdoutOffset: 2, limitBytes: 3 });
  assert.equal(Buffer.from(page.stdout.data, "base64").toString(), "cde");
  assert.equal(page.stdout.nextOffset, 5);
  assert.throws(() => manager.get(owner, { operationId: queued.operationId, stdoutOffset: 7 }), { code: "INVALID_OFFSET" });
  assert.throws(() => manager.get(owner, { operationId: queued.operationId, limitBytes: 65537 }), { code: "INVALID_LIMIT" });
});
test("cancel arriving before submit prevents the later command and survives restart", t => {
  const { manager, starts, options } = fixture(t), request = input();
  const cancelled = manager.cancel(owner, { operationId: request.operationId, requestId: crypto.randomUUID() });
  assert.equal(cancelled.state, "cancelled");
  const recovered = new TaskManager({ ...options, bootId: crypto.randomUUID() });
  assert.equal(recovered.submit(owner, request).state, "cancelled");
  assert.equal(starts(), 0);
  assert.throws(() => recovered.submit(owner, input(request.operationId, "changed")), { code: "REQUEST_CONFLICT" });
});
