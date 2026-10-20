"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { TaskManager } = require("../../src/pro/tasks.cjs");
const { processIdentity } = require("../../src/pro/task-process.cjs");
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", deviceId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await pause(20);
  }
  throw Error("Timed out waiting for isolated task fixture");
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-runner-"));
  const options = { dir: path.join(dir, "operations"), deviceId, bootId: crypto.randomUUID(),
    authorized: value => value === owner };
  const manager = new TaskManager(options);
  manager.space = () => {}; // These fixture commands write only small bounded output.
  t.after(async () => {
    for (const record of manager.records.values()) {
      try { manager.cancel(owner, { operationId: record.operationId, requestId: crypto.randomUUID() }); } catch {}
    }
    await pause(250);
    manager.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, manager, options };
}
function request(code, timeoutMs = 3000) {
  return { operationId: crypto.randomUUID(), kind: "exec",
    spec: { command: quote(process.execPath) + " -e " + quote(code), timeoutMs } };
}
const native = { skip: process.platform !== "linux" || !processIdentity(process.pid) };
test("live detached runner survives manager close and duplicate submit does not repeat effects", native, async t => {
  const { dir, manager, options } = fixture(t), counter = path.join(dir, "counter");
  const input = request("require('fs').appendFileSync(" + JSON.stringify(counter) +
    ",'once\\n');console.log('hello汉字');console.error('note');setTimeout(()=>{},300)");
  manager.submit(owner, input);
  await until(() => fs.existsSync(manager.file(input.operationId, "runner.json")), Boolean);
  manager.close();
  const recovered = new TaskManager({ ...options, bootId: crypto.randomUUID() });
  recovered.submit(owner, input);
  const result = await until(() => recovered.get(owner, input), value => value.state === "completed");
  assert.equal(result.result.exitCode, 0);
  assert.equal(Buffer.from(result.stdout.data, "base64").toString(), "hello汉字\n");
  assert.equal(Buffer.from(result.stderr.data, "base64").toString(), "note\n");
  assert.equal(fs.readFileSync(counter, "utf8"), "once\n");
  recovered.close();
});
test("cancel stops the isolated command tree and reports cancelled only after result", native, async t => {
  const { dir, manager } = fixture(t), counter = path.join(dir, "ticks");
  const input = request("setInterval(()=>require('fs').appendFileSync(" + JSON.stringify(counter) + ",'x'),25)");
  manager.submit(owner, input);
  await until(() => fs.existsSync(counter), Boolean);
  const response = manager.cancel(owner, { operationId: input.operationId, requestId: crypto.randomUUID() });
  assert.equal(response.state, "cancel_requested");
  const result = await until(() => manager.get(owner, input), value => value.state === "cancelled");
  assert.equal(result.result.cancelRequested, true);
  const size = fs.statSync(counter).size;
  await pause(100);
  assert.equal(fs.statSync(counter).size, size);
});
test("runner timeout is a final failed result with the same operation ID", native, async t => {
  const { manager } = fixture(t);
  const input = request("setInterval(()=>{},100)", 50);
  manager.submit(owner, input);
  const result = await until(() => manager.get(owner, input), value => value.state === "failed");
  assert.equal(result.operationId, input.operationId);
  assert.equal(result.errorCode, "EXEC_TIMEOUT");
});
test("an incoherent PID namespace refuses before any command side effect",
  { skip: process.platform !== "linux" || !!processIdentity(process.pid) }, async t => {
    const { dir, manager } = fixture(t), marker = path.join(dir, "must-not-exist");
    // Exercise the runner's independent guard even if a parent cached an
    // earlier capability. This never disables the runner ownership check.
    manager.identityAvailable = true;
    const input = request("require('fs').writeFileSync(" + JSON.stringify(marker) + ",'unexpected')");
    manager.submit(owner, input);
    const result = await until(() => manager.get(owner, input), value => value.state === "failed");
    assert.equal(result.errorCode, "PROCESS_IDENTITY_UNAVAILABLE");
    assert.equal(fs.existsSync(marker), false);
  });
