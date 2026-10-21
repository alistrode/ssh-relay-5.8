"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { SessionEngine } = require("../../src/pro/session-engine.cjs");
const { SessionLog } = require("../../src/pro/session-log.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-engine-"));
  const options = { dir, deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID(), owner: crypto.randomUUID(), platform: "linux", osBoot: "boot" };
  const child = new EventEmitter(), writes = []; let token = "start", signals = 0, spawns = 0;
  Object.assign(child, { pid: 999, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new Writable({ write(bytes, enc, callback) { writes.push(bytes.toString()); callback(); } }) });
  const deps = { spawn: () => { spawns++; return child; }, identity: pid => ({ pid, osBoot: "boot", startToken: token }), signal: () => { signals++; } };
  const engine = new SessionEngine(options, deps);
  t.after(() => { engine.close(options.owner); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, options, deps, child, writes, engine, signals: () => signals, spawns: () => spawns, changeIdentity: () => { token = "replacement"; } };
}
function input(timeoutMs = 1000) { return { requestId: crypto.randomUUID(), sequence: 1, spec: { command: "echo test", timeoutMs } }; }
test("engine saves one command, waits for both boundaries, and persists queryable output metadata", async t => {
  const f = fixture(t), request = input(), pending = f.engine.send(f.options.owner, request);
  const duplicate = await f.engine.send(f.options.owner, request);
  assert.equal(duplicate.state, "running"); assert.equal(f.writes.length, 1);
  const marker = f.writes[0].match(/RELAY_[a-f0-9]{32}/)[0];
  f.child.stdout.emit("data", Buffer.from("ok\n" + marker + ":0:L3RtcA==\n"));
  assert.equal(f.engine.journal.get(f.options.owner, request.requestId).completed, false);
  f.child.stderr.emit("data", Buffer.from("err\n" + marker + ":END\n"));
  const result = await pending;
  assert.equal(result.completed, true); assert.equal(result.result.cwd, "/tmp");
  assert.equal(result.result.output.stdout.bytes, 2); assert.equal(result.result.output.stderr.bytes, 3);
  const dir = f.engine.journal.directory(request.requestId);
  assert.equal(Buffer.from(SessionLog.page(dir, "stdout").data, "base64").toString(), "ok");
  assert.equal((await f.engine.send(f.options.owner, request)).result.exitCode, 0);
  assert.equal(f.writes.length, 1);
  assert.throws(() => new SessionEngine(f.options, f.deps), { code: "SESSION_ENGINE_EXISTS" });
  assert.equal(f.spawns(), 1);
});
test("timeout loses the shell and never replays or claims cancellation success", async t => {
  const f = fixture(t), request = input(10), result = await f.engine.send(f.options.owner, request);
  assert.equal(result.state, "unknown"); assert.equal(result.completed, false);
  assert.equal(result.errorCode, "SESSION_COMMAND_TIMEOUT"); assert.equal(f.signals(), 1);
  assert.throws(() => f.engine.send(f.options.owner, request), { code: "SESSION_LOST" });
  assert.equal(f.writes.length, 1); assert.equal(f.spawns(), 1);
});
test("reused process identity is never signalled", async t => {
  const f = fixture(t); f.changeIdentity(); f.engine.close(f.options.owner);
  assert.equal(f.signals(), 0);
});
test("unprovable host process identity refuses all shell creation", () => {
  let spawns = 0;
  assert.throws(() => new SessionEngine({}, { identity: () => null, spawn: () => { spawns++; } }), { code: "PROCESS_IDENTITY_UNAVAILABLE" });
  assert.equal(spawns, 0);
});
test("a final metadata read failure still resolves the caller as unknown", { timeout: 1000 }, async t => {
  const f = fixture(t), request = input(), pending = f.engine.send(f.options.owner, request);
  const marker = f.writes[0].match(/RELAY_[a-f0-9]{32}/)[0];
  f.engine.journal.get = () => { throw Error("simulated final read failure"); };
  f.child.stdout.emit("data", Buffer.from("\n" + marker + ":0:L3RtcA==\n"));
  f.child.stderr.emit("data", Buffer.from("\n" + marker + ":END\n"));
  const result = await pending;
  assert.equal(result.state, "unknown"); assert.equal(result.completed, false);
  assert.equal(f.engine.closed, true);
});
test("disk capacity failure refuses a command before shell input", async t => {
  const f = fixture(t); t.mock.method(fs, "statfsSync", () => ({ bavail: 0, bsize: 4096 }));
  const result = await f.engine.send(f.options.owner, input());
  assert.equal(result.state, "unknown"); assert.equal(result.errorCode, "SESSION_DISK_CAPACITY");
  assert.equal(f.writes.length, 0);
});
