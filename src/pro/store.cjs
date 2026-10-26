"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function folder(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink())
    throw Error("Private state cannot be a symlink");
  return dir;
}
function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) { require('./runtime-log.cjs').captureCaught(e,{component:'store.cjs',line:14});
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
function write(file, value) {
  folder(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error("Private state cannot be a symlink");
  const temp =
    file +
    "." +
    process.pid +
    "." +
    crypto.randomBytes(4).toString("hex") +
    ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'store.cjs',line:39}); }
  }
}
function text(file, value) {
  folder(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error("Private state cannot be a symlink");
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
function retryDelay(failures) {
  return failures <= 3
    ? 0
    : [2000, 4000, 8000, 16000, 30000, 60000][Math.min(failures - 4, 5)];
}
function id(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw Error("Invalid device ID");
  return value;
}
function broker(value) {
  const u = new URL(value);
  if (u.protocol !== "wss:" || u.username || u.password)
    throw Error("A credential-free WSS broker URL is required");
  return u.href;
}
let cachedBoot;
function systemBootId() {
  if (cachedBoot !== undefined) return cachedBoot;
  try {
    if (process.platform === "linux")
      return (cachedBoot = fs
        .readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
        .trim());
    if (process.platform === "win32") {
      const code =
        "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks";
      const r = require("node:child_process").spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(code, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      return (cachedBoot = r.status === 0 ? r.stdout.trim() : null);
    }
  } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'store.cjs',line:87}); }
  return (cachedBoot = null);
}
function ownedProcess(pid, dir, moduleName, bootId) {
  if (bootId && systemBootId() && bootId !== systemBootId()) return false;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
  } catch (e) { require('./runtime-log.cjs').captureCaught(e,{component:'store.cjs',line:96});
    return e.code === "EPERM";
  }
  try {
    if (process.platform === "linux") {
      const args = fs
        .readFileSync("/proc/" + pid + "/cmdline")
        .toString()
        .split("\0");
      return (
        args.includes(path.resolve(dir)) &&
        args.some((a) =>
          a.replace(/\\/g, "/").endsWith("/" + moduleName + ".cjs"),
        )
      );
    }
    if (process.platform === "win32") {
      const code =
        '(Get-CimInstance Win32_Process -Filter "ProcessId=' +
        pid +
        '").CommandLine';
      const r = require("node:child_process").spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(code, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      if (r.status !== 0) return true;
      if (!r.stdout.trim()) return true;
      const command = r.stdout.replace(/\\/g, "/").toLowerCase();
      return (
        command.includes(path.resolve(dir).replace(/\\/g, "/").toLowerCase()) &&
        command.includes("/" + moduleName + ".cjs")
      );
    }
    return true;
  } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'store.cjs',line:136});
    return false;
  }
}
module.exports = {
  ownedProcess,
  systemBootId,
  folder,
  read,
  write,
  text,
  retryDelay,
  id,
  broker,
};
