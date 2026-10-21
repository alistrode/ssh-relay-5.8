"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process");
const { TaskManager } = require("../../src/pro/tasks.cjs"), { SessionManager } = require("../../src/pro/session-manager.cjs");
const { processIdentity, processState } = require("../../src/pro/task-process.cjs"), { privateJSON } = require("../../src/pro/task-store.cjs");
const enabled = process.env.SSH_RELAY_NATIVE_ACCEPTANCE === "1", windows = process.platform === "win32";
const native = { skip: !enabled, timeout: 120000 }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = text => "'" + text.replace(/'/g, windows ? "''" : "'\\''") + "'";
async function until(read, accept, timeout = 90000) {
  const deadline = Date.now() + timeout; let value;
  while (Date.now() < deadline) { value = await read(); if (accept(value)) return value; await pause(150); }
  throw Error("Native acceptance timed out before the required observable state: " + JSON.stringify(value));
}
function fixture(t) {
  assert.ok(["linux", "win32"].includes(process.platform));
  assert.ok(processIdentity(process.pid), "Native process identity must be provable; refusing to weaken the guard");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-native-")), owner = crypto.randomUUID(), deviceId = crypto.randomUUID();
  const options = { dir: path.join(root, "tasks"), deviceId, bootId: crypto.randomUUID(), authorized: id => id === owner };
  const manager = new TaskManager(options);
  const state = { root, owner, deviceId, options, manager, beforeCleanup: null };
  t.after(async () => {
    if (state.beforeCleanup) await state.beforeCleanup();
    for (const r of manager.records.values()) try { manager.cancel(owner, { operationId: r.operationId, requestId: crypto.randomUUID() }); } catch {}
    manager.close();
    await pause(windows ? 2000 : 300);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return state;
}
function command(code) {
  const expression = "eval(Buffer.from(process.argv[1],process.argv[2]).toString())", encoded = Buffer.from(code).toString("base64");
  return (windows ? "$env:ELECTRON_RUN_AS_NODE='1'; & " : "ELECTRON_RUN_AS_NODE=1 ") + quote(process.execPath) + " -e " + quote(expression) + " " + quote(encoded) + " base64";
}
function request(code, cwd, timeoutMs = 60000) { return { operationId: crypto.randomUUID(), kind: "exec", spec: { command: command(code), cwd, timeoutMs } }; }
test("native detached task survives submitter exit and duplicate submit does not repeat its effect", native, async t => {
  const f = fixture(t), counter = path.join(f.root, "once");
  const input = request("require('fs').appendFileSync(" + JSON.stringify(counter) + ",'once\\n');console.log('native汉字');console.error('native-stderr');setTimeout(()=>{}," + (windows ? 10000 : 2000) + ")", f.root);
  const config = path.join(f.root, "submit.json");
  fs.writeFileSync(config, JSON.stringify({ dir: f.options.dir, owner: f.owner, deviceId: f.deviceId, input }), { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [path.resolve(__dirname, "../fixtures/native-submit.cjs"), config], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; child.stdout.resume(); child.stderr.on("data", bytes => { error += bytes.toString(); });
    child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(Error("Native submitter failed: " + error)));
  });
  const submitterExitedAt = Date.now(), recovered = new TaskManager({ ...f.options, bootId: crypto.randomUUID() });
  recovered.submit(f.owner, input);
  const result = await until(() => { recovered.tick(); return recovered.get(f.owner, input); }, value => value.state === "completed");
  assert.equal(result.result.exitCode, 0); assert.equal(result.errorCode, null);
  assert.ok(result.result.finishedAt >= submitterExitedAt);
  assert.equal(Buffer.from(result.stdout.data, "base64").toString(), "native汉字\n");
  assert.equal(Buffer.from(result.stderr.data, "base64").toString(), "native-stderr\n");
  assert.equal(fs.readFileSync(counter, "utf8"), "once\n"); recovered.close();
});
test("native cancellation stops the owned command tree before reporting final cancellation", native, async t => {
  const f = fixture(t), counter = path.join(f.root, "ticks");
  const tick = "setInterval(()=>require('fs').appendFileSync(" + JSON.stringify(counter) + ",'x'),50)";
  const expression = "eval(Buffer.from(process.argv[1],process.argv[2]).toString())";
  const input = request("require('child_process').spawn(process.execPath,['-e'," + JSON.stringify(expression) + "," + JSON.stringify(Buffer.from(tick).toString("base64")) + ",'base64'],{stdio:'ignore'});setInterval(()=>{},100)", f.root);
  f.manager.submit(f.owner, input); await until(() => fs.existsSync(counter), Boolean);
  const response = f.manager.cancel(f.owner, { operationId: input.operationId, requestId: crypto.randomUUID() });
  assert.equal(response.state, "cancel_requested");
  const result = await until(() => { f.manager.tick(); return f.manager.get(f.owner, input); }, value => value.state === "cancelled");
  assert.equal(result.result.cancelRequested, true);
  const size = fs.statSync(counter).size; await pause(500); assert.equal(fs.statSync(counter).size, size);
});
test("native timeout yields the original operation ID and a final failure", native, async t => {
  const f = fixture(t), input = request("setInterval(()=>{},100)", f.root, 1500);
  f.manager.submit(f.owner, input);
  const result = await until(() => { f.manager.tick(); return f.manager.get(f.owner, input); }, value => value.state === "failed");
  assert.equal(result.operationId, input.operationId); assert.equal(result.errorCode, "EXEC_TIMEOUT");
});
test("native session keeps the original shell across Manager recreation", native, async t => {
  const f = fixture(t), options = { dir: path.join(f.root, "sessions"), deviceId: f.deviceId, authorized: id => id === f.owner };
  let sessions = new SessionManager(options); const sessionId = crypto.randomUUID();
  sessions.create(f.owner, { sessionId });
  f.beforeCleanup = async () => {
    try { sessions.request(f.owner, { sessionId, requestId: crypto.randomUUID(), method: "close" }); } catch {}
    const runnerFile = path.join(sessions.directory(sessionId), "runner.json");
    await until(() => { const runner = privateJSON(runnerFile, null); return runner ? processState(runner) : "exited"; }, state => state === "exited", 30000);
  };
  await until(() => ({ ...sessions.status(f.owner, sessionId),
    runnerError: privateJSON(path.join(sessions.directory(sessionId), "runner-error.json"), null) }), value => value.shellAlive);
  const first = { sessionId, requestId: crypto.randomUUID(), sequence: 1, spec: { command: windows
    ? "Set-Location -LiteralPath " + quote(f.root) + "; $env:RELAY_NATIVE_SESSION='retained'; [Console]::Write('ready')"
    : "cd -- " + quote(f.root) + "; export RELAY_NATIVE_SESSION=retained; printf ready", timeoutMs: 60000 } };
  sessions.request(f.owner, first);
  const result = await until(() => { sessions.tick(); return sessions.queryRequest(f.owner, first); }, value => value.completed);
  assert.equal(Buffer.from(result.stdout.data, "base64").toString(), "ready");
  sessions = new SessionManager(options);
  const second = { sessionId, requestId: crypto.randomUUID(), sequence: 2, spec: { command: windows ? "[Console]::Write($env:RELAY_NATIVE_SESSION)" : "printf '%s' \"$RELAY_NATIVE_SESSION\"", timeoutMs: 60000 } };
  sessions.request(f.owner, second);
  const continued = await until(() => { sessions.tick(); return sessions.queryRequest(f.owner, second); }, value => value.completed);
  assert.equal(Buffer.from(continued.stdout.data, "base64").toString(), "retained");
  assert.equal(fs.realpathSync.native(continued.result.cwd), fs.realpathSync.native(f.root));
  assert.equal(sessions.request(f.owner, second).completed, true);
});
