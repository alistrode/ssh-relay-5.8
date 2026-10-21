"use strict";
const fs = require("node:fs"), path = require("node:path");
// Explicit UI action only. Fixed diagnostic names; never traverse task or user data.
function clearLogs(directory) {
  const base = fs.lstatSync(directory);
  if (!base.isDirectory() || base.isSymbolicLink()) throw Error("Invalid log directory");
  const names = ["agent-events.jsonl", "guardian-events.jsonl", "gui.jsonl", "launcher.jsonl", "chromium.log"];
  let cleared = 0;
  for (const name of names) for (const suffix of ["", ".1", ".2", ".3", ".previous"]) {
    const file = path.join(directory, name + suffix);
    let stat;
    try { stat = fs.lstatSync(file); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error("Invalid log file");
    const fd = fs.openSync(file, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stat.dev || opened.ino !== stat.ino) throw Error("Log file changed");
      fs.ftruncateSync(fd, 0); cleared++;
    } finally { fs.closeSync(fd); }
  }
  return { ok: true, cleared };
}
module.exports = { clearLogs };
