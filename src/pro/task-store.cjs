"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { folder } = require("./store.cjs");
function syncDirectory(dir) {
  let fd;
  try { fd = fs.openSync(dir, "r"); fs.fsyncSync(fd); return true; }
  catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-store.cjs',line:9});
    if (["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(error.code)) return false;
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function durableText(file, value) {
  folder(path.dirname(file));
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  let fd, renamed=false;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file); renamed=true;
    return { fileFsync: true, directoryFsync: syncDirectory(path.dirname(file)) };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { if(!renamed)fs.unlinkSync(temporary); } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-store.cjs',line:27}); if (error.code !== "ENOENT") throw error; }
  }
}
function durableWrite(file, value) { return durableText(file, JSON.stringify(value) + "\n"); }
function privateJSON(file, fallback) {
  let stat;
  try { stat = fs.lstatSync(file,{throwIfNoEntry:false}); }
  catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-store.cjs',line:34}); if (error.code === "ENOENT") return fallback; throw error; }
  if (!stat)return fallback;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    throw Object.assign(Error("Invalid operation record"), { code: "OPERATION_CORRUPT" });
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'task-store.cjs',line:38}); throw Object.assign(Error("Operation record cannot be decoded"), { code: "OPERATION_CORRUPT" }); }
}
module.exports = { durableWrite, durableText, privateJSON, syncDirectory };
