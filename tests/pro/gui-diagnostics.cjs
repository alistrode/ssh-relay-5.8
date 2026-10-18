"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), cp = require("node:child_process"), zlib = require("node:zlib");
const { create, exportDiagnostics } = require("../../src/pro/gui-diagnostics.cjs");
function fixture(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), "relay-gui-")); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
test("offline export excludes secrets, corrupted lines and untrusted fields", t => {
  const root = fixture(t), p = path.join(root, "logs"), d = create(p);
  d.record("child_process_gone", { type: "GPU", reason: "launch-failed", exitCode: 18, command: "secret", message: "token", version: "C:\\private" });
  fs.appendFileSync(path.join(p, "gui.jsonl"), 'broken\n'+JSON.stringify({time:new Date().toISOString(),runId:d.runId,event:"main_enter",secret:"password",type:"private-path"})+'\n');
  fs.writeFileSync(path.join(p,"chromium.log"), "C:\\private token GPU process launch failed: error_code=18\nGPU process isn't usable. Goodbye.");
  fs.mkdirSync(path.join(root, "near"));
  fs.writeFileSync(path.join(root, "near", "agent-events.jsonl"), JSON.stringify({ time:new Date().toISOString(),event:"connection_failed",deviceId:"secret",message:"password",pid:42 }) + "\n");
  const dest = path.join(p, "export.gz");
  assert.equal(exportDiagnostics(p, dest), 2);
  const data = zlib.gunzipSync(fs.readFileSync(dest)).toString();
  assert.doesNotMatch(data, /secret|token|private|password|broken/);
  assert.equal(JSON.parse(data).events[0].exitCode, 18);
  assert.deepEqual(JSON.parse(data).native, [{ previous:false, gpuLaunchFailures:{18:1}, gpuUnavailable:true }]);
  assert.equal(JSON.parse(data).background[0].pid, 42);
  assert.throws(() => exportDiagnostics(p, dest));
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
});
test("rotation bounds storage and keeps files private", t => {
  const p = fixture(t), d = create(p, { limit: 150 });
  for (let i=0;i<50;i++) d.record("main_enter", { pid: i });
  assert.equal(fs.readdirSync(p).length, 4);
  for (const f of fs.readdirSync(p)) { assert.ok(fs.statSync(path.join(p,f)).size < 400); assert.equal(fs.statSync(path.join(p,f)).mode & 0o777, 0o600); }
});
test("symlinks, unavailable logs and corrupt files do not mask startup", t => {
  const p = fixture(t), target = path.join(p,"target"), logs = path.join(p,"logs");
  fs.mkdirSync(logs); fs.writeFileSync(target,"preserve"); fs.symlinkSync(target,path.join(logs,"gui.jsonl"));
  const d=create(logs); assert.doesNotThrow(()=>d.record("main_enter")); assert.equal(d.available,false); assert.equal(fs.readFileSync(target,"utf8"),"preserve");
  assert.throws(()=>exportDiagnostics(logs,path.join(p,"out")));
  const unavailable=create(path.join(target,"child")); assert.doesNotThrow(()=>unavailable.record("main_enter")); assert.equal(unavailable.available,false);
});
test("pipe guards only ignore closed pipes; fatal errors still terminate", () => {
  const modulePath = path.resolve(__dirname,"../../src/pro/gui-diagnostics.cjs");
  for (const stream of ["stdout","stderr"]) {
    const r=cp.spawnSync(process.execPath,["-e",`require(${JSON.stringify(modulePath)}).installPipeGuards(()=>{}); process.${stream}.emit('error',Object.assign(new Error('closed'),{code:'EPIPE'}))`]); assert.equal(r.status,0);
  }
  const r=cp.spawnSync(process.execPath,["-e",`require(${JSON.stringify(modulePath)}).installPipeGuards(()=>{}); process.stdout.emit('error',Object.assign(new Error('unrelated'),{code:'EACCES'}))`]); assert.notEqual(r.status,0);
});
