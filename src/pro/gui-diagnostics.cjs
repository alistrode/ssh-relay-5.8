"use strict";
// Private diagnostics retain bounded, redacted errors and stacks; never command bodies or credentials.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
function check(file) {
  try { if (fs.lstatSync(file).isSymbolicLink()) throw Error("Diagnostic symlink refused"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
}
function create(directory, { limit = 256 * 1024, copies = 2, runId = crypto.randomUUID() } = {}) {
  const sink = require("./runtime-log.cjs").createLogger({file:path.join(directory,"gui.jsonl"),name:"gui",limit,copies});
  let available=true;
  return {record:(event,details={})=>{available=sink.record(event,{runId,...details});},runId,get available(){return available;}};
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
          if (!/^[a-z0-9_]+$/.test(e.event) || !/^[a-f0-9-]{36}$/.test(e.runId) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.time)) continue;
          events.push(require("./runtime-log.cjs").safe(e));
        } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'gui-diagnostics.cjs',line:42}); }
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
            if (backgroundEvents.has(e.event) && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.time)) background.push({role,...require("./runtime-log.cjs").safe(e)});
          } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'gui-diagnostics.cjs',line:60}); }
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
  const runtime = [];
  for (const dir of [directory,path.join(path.dirname(directory),'near','logs'),path.join(path.dirname(directory),'far','logs')]) {
    if(!fs.existsSync(dir))continue;
    for(const name of fs.readdirSync(dir).filter(n=>/^runtime-.+\.jsonl(?:\.\d+)?$/.test(n))) {
      const file=path.join(dir,name);check(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.size>300*1024)continue;
      for(const line of fs.readFileSync(file,'utf8').split('\n')){try{const e=JSON.parse(line);if(typeof e.event==='string')runtime.push(require('./runtime-log.cjs').safe(e));}catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'gui-diagnostics.cjs',line:82}); }}
    }
  }
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeSync(fd, zlib.gzipSync(JSON.stringify({ schema: 2, events, background, native, runtime:runtime.slice(-4096) }))); }
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
  } catch (error) { require("./runtime-log.cjs").captureCaught(error,{component:"diagnostic-export"});process.stderr.write("Diagnostic export failed; preserve the local logs.\n"); process.exitCode = 1; }
}

