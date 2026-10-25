"use strict";
const os = require("node:os"), fs = require("node:fs");
let cached;
function clean(value) { return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 160) : ""; }
function normalizeSystem(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  for (const key of ["name", "version", "build", "platform", "arch", "displayName"]) result[key] = clean(value[key]);
  return result.displayName ? result : null;
}
function systemVersion() {
  if (cached) return cached;
  const platform = process.platform, release = os.release();
  let name = os.type(), version = release, build = release;
  if (platform === "linux") {
    try {
      const values = Object.fromEntries(fs.readFileSync("/etc/os-release", "utf8").split("\n").flatMap(line => {
        const m = /^([A-Z_]+)=(.*)$/.exec(line); return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, "")]] : [];
      }));
      name = values.NAME || "Linux"; version = values.VERSION_ID || release;
    } catch { name = "Linux"; }
  } else if (platform === "win32") {
    name = os.version();
    if (!/server/i.test(name)) name = Number(release.split(".")[2]) >= 22000 ? "Windows 11" : "Windows 10";
    try {
      const script = "$p=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';@{version=$p.DisplayVersion;build=($p.CurrentBuildNumber+'.'+$p.UBR)}|ConvertTo-Json -Compress";
      const value = JSON.parse(require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script,"utf16le").toString("base64")], { encoding:"utf8", windowsHide:true, timeout:10000 }));
      version = value.version || release; build = value.build || release;
    } catch { /* Native OS information remains available without the registry. */ }
  }
  return cached = normalizeSystem({ name, version, build, platform, arch: os.arch(),
    displayName: `${name} ${version}${build !== version ? " · " + build : ""} · ${os.arch()}` });
}
module.exports = { systemVersion, normalizeSystem };
