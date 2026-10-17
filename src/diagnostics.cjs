"use strict";
const fs = require("node:fs");
const path = require("node:path");
// This sink receives metadata only: no commands, payloads, keys, or connection blocks.
function createTraceWriter(directory, role) {
  const file = path.join(directory, role + "-events.jsonl");
  const limit = 2 * 1024 * 1024;
  let failed = false;
  return function record(entry) {
    if (failed) return;
    try {
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
        throw new Error("Diagnostic path is a symlink");
      if (fs.existsSync(file) && fs.statSync(file).size >= limit) {
        for (let i = 2; i >= 1; i--) {
          const from = file + "." + i,
            to = file + "." + (i + 1);
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
        fs.renameSync(file, file + ".1");
      }
      fs.appendFileSync(
        file,
        JSON.stringify({ time: new Date().toISOString(), role, ...entry }) +
          "\n",
        { mode: 0o600 },
      );
    } catch (error) {
      failed = true;
      console.error("Diagnostic log unavailable: " + error.message);
    }
  };
}
module.exports = { createTraceWriter };
