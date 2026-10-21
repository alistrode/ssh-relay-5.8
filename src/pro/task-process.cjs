"use strict";
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const { systemBootId } = require("./store.cjs");
function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const osBoot = systemBootId();
  if (!osBoot) return null;
  try {
    if (process.platform === "linux") {
      // Some container runtimes virtualize process.pid without mounting a
      // matching /proc. Such a namespace cannot prove ownership of any PID.
      const self = fs.readFileSync("/proc/self/stat", "utf8");
      if (Number(self.slice(0, self.indexOf(" "))) !== process.pid) return null;
      const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z") return null;
      return { pid, osBoot, startToken: fields[19],
        args: fs.readFileSync("/proc/" + pid + "/cmdline").toString().split("\0").filter(Boolean) };
    }
    if (process.platform === "win32") {
      const script = "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid +
        "';if($p){[pscustomobject]@{startToken=$p.CreationDate.ToUniversalTime().Ticks.ToString();command=$p.CommandLine}|ConvertTo-Json -Compress}";
      const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")],
        { encoding: "utf8", windowsHide: true, timeout: 10000 });
      if (result.status !== 0 || !result.stdout.trim()) return null;
      const value = JSON.parse(result.stdout);
      if (!value.startToken || !value.command) return null;
      return { pid, osBoot, startToken: value.startToken, command: value.command };
    }
  } catch {}
  return null;
}
function sameProcess(expected) {
  const current = processIdentity(expected?.pid);
  return current && current.osBoot === expected.osBoot && current.startToken === expected.startToken ? current : null;
}
function runnerArgumentsMatch(current, directory, script, windows = process.platform === "win32") {
  const normalize = value => windows ? value.replace(/\\/g, "/").toLowerCase() : value;
  const expected = normalize(path.resolve(directory));
  const args = current.args || (current.command || "").match(/"[^"]*"|\S+/g)?.map(arg =>
    arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg);
  if (!Array.isArray(args)) return false;
  const normalized = args.map(normalize);
  return normalized.includes(expected) && normalized.some(arg => arg === script || arg.endsWith("/" + script));
}
function ownedProcessRunner(record, directory, script, directoryField) {
  const current = sameProcess(record);
  if (!current || path.resolve(record[directoryField] || "") !== path.resolve(directory)) return false;
  return runnerArgumentsMatch(current, directory, script);
}
function ownedRunner(record, directory) { return ownedProcessRunner(record, directory, "task-runner.cjs", "operationDir"); }
function ownedSessionRunner(record, directory) { return ownedProcessRunner(record, directory, "session-runner.cjs", "sessionDir"); }
module.exports = { processIdentity, sameProcess, ownedRunner, ownedSessionRunner, runnerArgumentsMatch };
