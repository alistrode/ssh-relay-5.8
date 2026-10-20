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
function ownedRunner(record, directory) {
  const current = sameProcess(record);
  if (!current || path.resolve(record.operationDir || "") !== path.resolve(directory)) return false;
  if (current.args)
    return current.args.includes(path.resolve(directory)) && current.args.some(arg => /[/\\]task-runner\.cjs$/.test(arg));
  const command = (current.command || "").replace(/\\/g, "/").toLowerCase();
  return command.includes("/task-runner.cjs") && command.includes(path.resolve(directory).replace(/\\/g, "/").toLowerCase());
}
module.exports = { processIdentity, sameProcess, ownedRunner };
