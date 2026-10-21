"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
function denied() {
  return Object.assign(Error("Local Agent state is not isolated to the current account"),
    { code: "LOCAL_STATE_PERMISSIONS" });
}
function assertPrivateState(dir) {
  const paths = [dir, path.join(dir, "agent-runtime.json"), path.join(dir, "identity.json")];
  const existing = paths.filter(file => {
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (file === dir ? !stat.isDirectory() : !stat.isFile())) throw denied();
      if (process.platform !== "win32" && typeof process.getuid === "function" &&
          (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) throw denied();
      return true;
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  });
  if (process.platform !== "win32" || !existing.length) return;
  // Check ACLs, do not alter inherited rights or request elevation.
  const script = "$ErrorActionPreference='Stop'\nImport-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop\nImport-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop\n$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$trusted=@($user,'S-1-5-18','S-1-5-32-544')\n$paths=ConvertFrom-Json $env:SSH_RELAY_PRIVATE_STATE_CHECK\nforeach($p in $paths){\n  $acl=Get-Acl -LiteralPath $p\n  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value\n  if($trusted -notcontains $owner){exit 3}\n  foreach($rule in $acl.Access){\n    if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){\n      $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value\n      if($trusted -notcontains $sid){exit 4}\n    }\n  }\n}\nexit 0";
  const result = cp.spawnSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, timeout: 15000,
      env: { ...process.env, SSH_RELAY_PRIVATE_STATE_CHECK: JSON.stringify(existing) } });
  if (result.error || result.status !== 0) throw denied();
}
module.exports = { assertPrivateState };
