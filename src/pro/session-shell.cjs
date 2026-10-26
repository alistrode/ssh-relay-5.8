"use strict";
const { normalizeSpec } = require("./task-spec.cjs");
function quote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function sessionCommand(platform, marker, command) {
  if (!/^RELAY_[a-f0-9]{32}$/.test(marker)) throw Object.assign(Error("Invalid session marker"), { code: "SESSION_INVALID" });
  normalizeSpec({ command }, platform);
  if (command.includes("\0")) throw Object.assign(Error("Session command contains a null byte"), { code: "SESSION_INVALID" });
  if (platform === "linux") return "eval " + quote(command) + "\n" +
    "__relay_status=$?\n" +
    "__relay_cwd=$(ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS= NODE_PATH= " + quote(process.execPath) + " -e " +
      quote('process.stdout.write(Buffer.from(process.cwd(),"utf8").toString("base64"))') + ")\n" +
    "command printf '\\n%s:%s:%s\\n' " + quote(marker) + " \"$__relay_status\" \"$__relay_cwd\"\n" +
    "command printf '\\n%s:END\\n' " + quote(marker) + " >&2\n";
  const encoded = Buffer.from(command, "utf8").toString("base64");
  return "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';$global:LASTEXITCODE=0;" +
    "try {. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))));" +
    "$__relayCode=if($?){if($LASTEXITCODE){$LASTEXITCODE}else{0}}else{1}}" +
    "catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-shell.cjs',line:18});[Console]::Error.WriteLine($_.Exception.Message);$__relayCode=1};" +
    "[Console]::Out.Write(('`n" + marker + ":'+$__relayCode+':'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))+'`n').Replace('`n', [string][char]10));" +
    "[Console]::Error.Write(('`n" + marker + ":END`n').Replace('`n', [string][char]10))\n";
}
module.exports = { sessionCommand };
