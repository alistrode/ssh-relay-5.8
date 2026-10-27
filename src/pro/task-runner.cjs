"use strict";
const runtimeLog=require('./runtime-log.cjs').install('task-runner');
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const { write, folder } = require("./store.cjs");
const { durableWrite, durableText, privateJSON } = require("./task-store.cjs");
const { operationId, normalizeTask, requestHash } = require("./task-spec.cjs");
const { processIdentity, sameProcess } = require("./task-process.cjs");
const LIMIT = 64 * 1024 * 1024;
async function run(directory) {
  await require("./task-process.cjs").prepareIdentity();
  directory = path.resolve(directory);
  const key = operationId(path.basename(directory));
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error("Invalid operation directory");
  const file = name => path.join(directory, name);
  let manifest = privateJSON(file("manifest.json"));
  if (!manifest || manifest.operationId !== key || !["exec", "job"].includes(manifest.kind) || manifest.state !== "starting")
    throw Error("Operation is not authorized to start");
  operationId(manifest.owner);
  const input = privateJSON(file("input.json"));
  const spec = normalizeTask(manifest.kind, input?.spec), job = manifest.kind === "job";
  if (requestHash(manifest.deviceId, manifest.kind, spec) !== manifest.requestHash)
    throw Error("Operation input does not match its accepted request");
  try { fs.mkdirSync(file("execution.lock"), { mode: 0o700 }); }
  catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-runner.cjs',line:26}); if (error.code === "EEXIST") return; throw error; }
  if (privateJSON(file("result.json"), null)) return;
  const identity = processIdentity(process.pid);
  if (!identity) {
    const finishedAt = Date.now();
    durableWrite(file("result.json"), { operationId: key, owner: manifest.owner, state: "failed",
      errorCode: "PROCESS_IDENTITY_UNAVAILABLE", exitCode: null, signal: null, finishedAt,
      stdout: { bytes: 0, totalBytes: 0, truncated: false },
      stderr: { bytes: 0, totalBytes: 0, truncated: false } });
    durableWrite(file("manifest.json"), { ...manifest, state: "failed", updatedAt: finishedAt });
    fs.unlinkSync(file("input.json"));
    return;
  }
  const runnerRecord = { ...identity, operationDir: directory, operationId: key, heartbeatAt: Date.now() };
  durableWrite(file("runner.json"), runnerRecord);
  const output = {
    stdout: { fd: fs.openSync(file("stdout.bin"), "wx", 0o600), bytes: 0, totalBytes: 0, truncated: false },
    stderr: { fd: fs.openSync(file("stderr.bin"), "wx", 0o600), bytes: 0, totalBytes: 0, truncated: false },
  };
  let child, childIdentity, interval, timeout, killTimer, killer, finishing = false;
  let reason = null, cancellationApplied = false, cancellationError = null, outputError = false;
  const script = job ? null : file(spec.shell === "powershell" ? "executor.ps1" : "executor.sh");
  const temporary = job ? folder(file("tmp")) : null;
  const windows = process.platform === "win32";
  const source = windows
    ? "\uFEFF$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$global:LASTEXITCODE=0;try {\n" +
      spec.command + "\n;if($LASTEXITCODE){exit $LASTEXITCODE}} catch {[Console]::Error.WriteLine($_.Exception.Message);exit 1}\n"
    : spec.command + "\n";
  if (script) durableText(script, source);
  function stop(why) {
    if (why === "output_storage") outputError = true;
    if (reason) return;
    reason = why;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (!childIdentity || !sameProcess(childIdentity)) {
      cancellationError = "PROCESS_IDENTITY_UNCONFIRMED";
      return;
    }
    if (windows) {
      killer = new Promise(resolve => {
        const proc = cp.spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        proc.once("error", () => { cancellationError = "CANCEL_FAILED"; resolve(); });
        proc.once("close", code => { cancellationApplied = code === 0; if (code !== 0) cancellationError = "CANCEL_FAILED"; resolve(); });
      });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); cancellationApplied = true; }
      catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-runner.cjs',line:73}); cancellationError = "CANCEL_FAILED"; return; }
      killTimer = setTimeout(() => {
        if (sameProcess(childIdentity)) {
          try { process.kill(-child.pid, "SIGKILL"); } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'task-runner.cjs',line:76}); }
        }
      }, 3000);
    }
  }
  function append(name, data) {
    const stream = output[name];
    stream.totalBytes += data.length;
    const allowed = Math.max(0, Math.min(data.length, LIMIT - stream.bytes));
    if (allowed < data.length) stream.truncated = true;
    if (!allowed || outputError) return;
    try {
      let offset = 0;
      while (offset < allowed) {
        const written = fs.writeSync(stream.fd, data, offset, allowed - offset);
        if (!written) throw Error("Output write stalled");
        offset += written; stream.bytes += written;
      }
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-runner.cjs',line:94}); outputError = true; stop("output_storage"); }
  }
  async function finish(code, signal, spawnError) {
    if (finishing) return;
    finishing = true;
    clearInterval(interval); clearTimeout(timeout); clearTimeout(killTimer);
    if (killer) await killer;
    for (const stream of Object.values(output)) {
      try { fs.fsyncSync(stream.fd); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-runner.cjs',line:102}); outputError = true; }
      try { fs.closeSync(stream.fd); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-runner.cjs',line:103}); outputError = true; }
    }
    const state = outputError ? "unknown" : reason === "timeout" || spawnError ? "failed" :
      reason === "cancel" && (!child || cancellationApplied) ? "cancelled" :
      code === 0 ? "completed" : "failed";
    const result = {
      operationId: key, owner: manifest.owner, state, exitCode: code, signal,
      finishedAt: Date.now(), cancelRequested: reason === "cancel", cancellationError,
      errorCode: outputError ? "OUTPUT_STORAGE_FAILED" : spawnError ? "EXEC_SPAWN_FAILED" :
        reason === "timeout" ? "EXEC_TIMEOUT" : null,
      stdout: { bytes: output.stdout.bytes, totalBytes: output.stdout.totalBytes, truncated: output.stdout.truncated },
      stderr: { bytes: output.stderr.bytes, totalBytes: output.stderr.totalBytes, truncated: output.stderr.truncated },
    };
    durableWrite(file("result.json"), result);
    manifest = { ...manifest, state, updatedAt: result.finishedAt };
    durableWrite(file("manifest.json"), manifest);
    for (const name of ["input.json", ...(script ? [path.basename(script)] : [])]) {
      try { fs.unlinkSync(file(name)); } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-runner.cjs',line:120}); if (error.code !== "ENOENT") throw error; }
    }
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
  if (privateJSON(file("cancel.json"), null)) {
    reason = "cancel"; await finish(null, null, false); return;
  }
  durableWrite(file("manifest.json"), { ...manifest, state: "running", startedAt: Date.now() });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  if (job) {
    env.ELECTRON_RUN_AS_NODE = "1";
    env.TMPDIR = temporary; env.TMP = temporary; env.TEMP = temporary;
  }
  const executable = job ? process.execPath : windows
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "/bin/sh",
    args = job ? [path.join(__dirname, "job-executor.cjs"), directory] :
      windows ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script] : [script];
  child = cp.spawn(executable, args,
    { cwd: spec.cwd || os.homedir(), env, windowsHide: true, detached: !windows,
      stdio: ["ignore", "pipe", "pipe"] });
  child.once("spawn", () => { childIdentity = processIdentity(child.pid); });
  child.stdout.on("data", data => append("stdout", data));
  child.stderr.on("data", data => append("stderr", data));
  child.on("error", () => finish(null, null, true).catch(error => { runtimeLog.record("task_runner_failed",{error});process.exitCode = 1; }));
  child.on("close", (code, signal) => finish(code, signal, false).catch(error => { runtimeLog.record("task_runner_failed",{error});process.exitCode = 1; }));
  interval = setInterval(() => {
    try {
      if (Date.now() - runnerRecord.heartbeatAt >= 2000) {
        runnerRecord.heartbeatAt = Date.now();
        write(file("runner.json"), runnerRecord);
      }
      const request = privateJSON(file("cancel.json"), null);
      if (request && request.owner === manifest.owner) stop("cancel");
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-runner.cjs',line:153}); stop("output_storage"); }
  }, 200);
  timeout = setTimeout(() => stop("timeout"), spec.timeoutMs);
  process.on("SIGTERM", () => stop("cancel"));
  await new Promise(resolve => child.once("close", resolve));
}
module.exports = { run, LIMIT };
if (require.main === module) run(process.argv[2]).catch(error => { runtimeLog.record("task_runner_failed",{error});process.exitCode = 1; });
