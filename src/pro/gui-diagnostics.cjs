"use strict";
// Startup diagnostics deliberately accept metadata only, never error messages,
// command lines, URLs, paths, credentials, or renderer console contents.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const fields = new Set(["pid", "exitCode", "errorCode", "type", "reason", "version", "platform", "code"]);
const enums = new Set(["GPU", "Utility", "Renderer", "Browser", "Zygote", "Sandbox helper", "clean-exit", "abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure", "win32", "linux", "darwin", "EPIPE", "ERR_STREAM_DESTROYED"]);
const eventNames = new Set(["main_enter", "electron_loaded", "uncaught_exception", "process_exit", "child_process_gone", "render_process_gone", "window_create", "window_loaded", "window_load_failed", "window_shown", "window_load_rejected", "before_quit", "app_ready", "output_pipe_closed", "launcher_enter", "runtime_missing", "process_started", "launcher_child_exit", "launcher_failed", "startup_permission_rejected", "permission_check_failed"]);
for (const event of ["elevation_requested", "elevated_launcher_exit", "elevation_not_completed", "startup_failed", "switch_prompt_unavailable", "switch_prompt_shown", "switch_prompt_approved", "switch_prompt_declined"]) eventNames.add(event);
function metadata(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!fields.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && (enums.has(value) || (key === "version" && /^\d+\.\d+\.\d+$/.test(value)))) out[key] = value;
  }
  return out;
}
function check(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) throw Error("Diagnostic symlink refused"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
}
function create(directory, { limit = 256 * 1024, copies = 3, runId = /^[a-f0-9-]{36}$/.test(process.env.SSH_RELAY_RUN_ID || "") ? process.env.SSH_RELAY_RUN_ID : crypto.randomUUID() } = {}) {
  const file = path.join(directory, "gui.jsonl");
  let available = true;
  function record(event, details) {
    if (!eventNames.has(event)) return;
    try {
      check(directory);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      check(file);
      if (fs.existsSync(file) && fs.statSync(file).size >= limit) {
        for (let i = copies; i >= 1; i--) {
          const source = i === 1 ? file : file + "." + (i - 1), dest = file + "." + i;
          check(source); check(dest);
          if (fs.existsSync(source)) fs.renameSync(source, dest);
        }
      }
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0), 0o600);
      try {
        fs.fchmodSync(fd, 0o600);
        fs.writeSync(fd, JSON.stringify({ time: new Date().toISOString(), runId, event, ...metadata(details) }) + "\n");
      } finally { fs.closeSync(fd); }
    } catch { available = false; }
  }
  return { record, runId, get available() { return available; } };
}
function exportDiagnostics(directory, destination) {
  const events = [];
  for (const name of ["launcher.jsonl.3", "launcher.jsonl.2", "launcher.jsonl.1", "launcher.jsonl", "gui.jsonl.3", "gui.jsonl.2", "gui.jsonl.1", "gui.jsonl"]) {
    const file = path.join(directory, name);
    check(file);
    if (!fs.existsSync(file)) continue;
    // Bound reads even if an external process replaced a diagnostic file.
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const buffer = Buffer.alloc(256 * 1024 + 2048), n = fs.readSync(fd, buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, n).toString("utf8").split("\n")) {
        try {
          const e = JSON.parse(line);
          if (!eventNames.has(e.event) || !/^[a-f0-9-]{36}$/.test(e.runId) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.time)) continue;
          events.push({ time: e.time, runId: e.runId, event: e.event, ...metadata(e) });
        } catch {}
      }
    } finally { fs.closeSync(fd); }
  }
  const background = [];
  const backgroundEvents = new Set(["agent_started", "agent_stopped", "worker_started", "worker_exited", "worker_spawn_error", "connection_verified", "connection_failed", "pair_saved", "pair_offer_created", "device_unpaired", "api_error", "guardian_started", "guardian_stopped", "agent_exited", "agent_spawned"]);
  for (const role of ["near", "far"]) {
    const roleDirectory = path.join(path.dirname(directory), role); check(roleDirectory);
    for (const name of ["guardian-events.jsonl.1", "guardian-events.jsonl", "agent-events.jsonl.1", "agent-events.jsonl"]) {
      const file = path.join(roleDirectory, name); check(file);
      if (!fs.existsSync(file)) continue;
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const buffer = Buffer.alloc(256 * 1024), n = fs.readSync(fd, buffer, 0, buffer.length, 0);
        for (const line of buffer.subarray(0, n).toString("utf8").split("\n")) {
          try {
            const e = JSON.parse(line);
            if (backgroundEvents.has(e.event) && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.time)) background.push({ role, time:e.time, event:e.event, ...metadata(e) });
          } catch {}
        }
      } finally { fs.closeSync(fd); }
    }
  }
  const native = [];
  for (const name of ["chromium.log.previous", "chromium.log"]) {
    const file = path.join(directory, name); check(file);
    if (!fs.existsSync(file)) continue;
    const input = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const buffer = Buffer.alloc(256 * 1024), count = fs.readSync(input, buffer, 0, buffer.length, 0), text = buffer.subarray(0, count).toString("utf8");
      const gpuLaunchFailures = {};
      for (const match of text.matchAll(/GPU process launch failed: error_code=(\d{1,8})/g)) gpuLaunchFailures[match[1]] = (gpuLaunchFailures[match[1]] || 0) + 1;
      native.push({ previous: name.endsWith("previous"), gpuLaunchFailures, gpuUnavailable: text.includes("GPU process isn't usable") });
    } finally { fs.closeSync(input); }
  }
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeSync(fd, zlib.gzipSync(JSON.stringify({ schema: 1, events, background, native }))); }
  finally { fs.closeSync(fd); }
  return events.length;
}
function installPipeGuards(record) {
  for (const stream of [process.stdout, process.stderr]) stream.on("error", error => {
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") throw error;
    record("output_pipe_closed", { code: error.code });
  });
}
module.exports = { create, exportDiagnostics, installPipeGuards };
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error("Expected log directory and new export file");
    exportDiagnostics(process.argv[2], process.argv[3]);
  } catch { process.stderr.write("Diagnostic export failed; preserve the local logs.\n"); process.exitCode = 1; }
}
