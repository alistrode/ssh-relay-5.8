"use strict";
const runtimeLog=require('./runtime-log.cjs').install('guardian');
const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  {
    folder,
    read,
    write,
    retryDelay,
    ownedProcess,
    systemBootId,
  } = require("./store.cjs"),
  { createTraceWriter } = require("../diagnostics.cjs");
const { clientActive } = require("./client-lifecycle.cjs");
const args = process.argv.slice(2),
  at = args.indexOf("--state-dir");
if (at < 0) throw Error("Guardian requires a private state directory");
const dir = path.resolve(folder(args[at + 1])),
  runtime = path.join(dir, "guardian-runtime.json"),
  record = createTraceWriter(dir, "guardian");
let child,
  timer,
  stopping = false,
  failures = 0;
const previous = read(runtime, null);
if (previous?.pid) {
  if (ownedProcess(previous.pid, dir, "guardian", previous.osBoot))
    {record({event:"guardian_duplicate_exit"});process.exit(0);}
}
// A separate exclusive lock covers simultaneous GUI and service starts.
const lock = path.join(dir, "guardian.lock");
try {
  fs.mkdirSync(lock, { mode: 0o700 });
} catch (e) { require('./runtime-log.cjs').captureCaught(e,{component:'guardian.cjs',line:35});
  if (e.code !== "EEXIST") throw e;
  const owner = read(path.join(lock, "owner.json"), {});
  const alive = ownedProcess(owner.pid, dir, "guardian", owner.osBoot);
  if (alive || Date.now() - fs.statSync(lock).mtimeMs < 5000) {record({event:"guardian_lock_exit",alive});process.exit(0);}
  fs.rmSync(lock, { recursive: true });
  fs.mkdirSync(lock, { mode: 0o700 });
}
write(path.join(lock, "owner.json"), {
  pid: process.pid,
  osBoot: systemBootId(),
});
write(runtime, {
  pid: process.pid,
  startedAt: Date.now(),
  osBoot: systemBootId(),
});
function finish() {
  if (stopping) return;
  record({event:"guardian_finish",clientActive:clientActive(dir)});
  stopping = true;
  clearTimeout(timer);
  if (child && !child.killed) child.kill("SIGTERM");
  record({ event: "guardian_stopped" });
  try {
    fs.unlinkSync(runtime);
  } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'guardian.cjs',line:61});record({event:"guardian_cleanup_error",error});}
  try {
    fs.rmSync(lock, { recursive: true });
  } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'guardian.cjs',line:64});record({event:"guardian_cleanup_error",error});}
  if (!child) process.exit(0);
  else setTimeout(() => process.exit(0), 10000).unref();
}
function spawn() {
  if (stopping) return;
  if (!clientActive(dir)) { finish(); return; }
  record({ event: "guardian_agent_start", attempt: failures + 1 });
  const proc = cp.spawn(
    process.execPath,
    [path.join(__dirname, "agent.cjs"), ...args],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SSH_RELAY_CLIENT_PROFILE: require("./client-lifecycle.cjs").profileFor(dir) },
    },
  );
  child = proc;
  let stoppingAgent = false;
  const stable = setTimeout(() => {
    if (child === proc) failures = 0;
  }, 10000);
  stable.unref();
  for (const stream of [proc.stdout, proc.stderr])
    stream.on("data", (data) =>
      record({
        event: "agent_console",
        message: data
          .toString()
          .replace(/BUNDLE=.*/g, "[REDACTED]")
          .slice(0, 500),
      }),
    );
  proc.on("message", (message) => {
    if (message?.type === "stop-guardian") {
      stoppingAgent = true;
      stopping = true;
    }
  });
  proc.on("error", (error) =>
    record({ event: "guardian_spawn_error", code: error.code }),
  );
  proc.on("close", (code, signal) => {
    clearTimeout(stable);
    if (child === proc) child = null;
    record({
      event: "guardian_agent_exit",
      code,
      signal,
      intentional: stoppingAgent || stopping,
    });
    if (stoppingAgent || stopping) {
      stopping = false;
      finish();
      return;
    }
    const delay = retryDelay(++failures);
    record({
      event: "guardian_retry_scheduled",
      attempt: failures,
      delayMs: delay,
    });
    timer = setTimeout(spawn, delay);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, finish);
spawn();
const clientTimer = setInterval(() => { if (!clientActive(dir)) { clearInterval(clientTimer); finish(); } }, 1000);
