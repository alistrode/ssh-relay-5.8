"use strict";
const fs = require("node:fs"), path = require("node:path");
const { privateJSON } = require("./task-store.cjs");
const { processState } = require("./task-process.cjs");
function cleanupSessions(root, deviceId, { inspect = processState, now = Date.now(), limit = 2, startAfter, onExamined = () => {} } = {}) {
  const removed = []; let examined = 0;
  const names = fs.readdirSync(root).sort();
  const position = startAfter ? names.findIndex(name => name > startAfter) : 0;
  const index = Math.max(0, position);
  for (const sessionId of [...names.slice(index), ...names.slice(0, index)]) {
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) continue;
    const dir = path.join(root, sessionId);
    try {
      const stat = fs.lstatSync(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const config = privateJSON(path.join(dir, "session.json"), null);
      if (!config || config.deviceId !== deviceId || config.sessionId !== sessionId || typeof config.owner !== "string" ||
          typeof config.osBoot !== "string" || !config.osBoot) continue;
      const manifest = privateJSON(path.join(dir, "manifest.json"), null), error = privateJSON(path.join(dir, "runner-error.json"), null);
      const shell = privateJSON(path.join(dir, "shell.json"), null), runner = privateJSON(path.join(dir, "runner.json"), null);
      const emptyStartup = !manifest && !shell && !fs.existsSync(path.join(dir, "engine.lock"));
      const closedAt = manifest?.closedAt || (emptyStartup ? error?.finishedAt : null);
      if (!Number.isFinite(closedAt) || now - closedAt <= 7 * 86400000 ||
          (manifest && (!["lost", "closed"].includes(manifest.state) || manifest.sessionId !== sessionId || manifest.owner !== config.owner))) continue;
      if (examined >= limit) break;
      examined++; onExamined(sessionId);
      const validProcess = record => record && record.sessionId === sessionId && record.owner === config.owner &&
        record.osBoot === config.osBoot && path.resolve(record.sessionDir || "") === path.resolve(dir) && inspect(record) === "exited";
      if (runner ? !validProcess(runner) : !emptyStartup) continue;
      if (shell ? !validProcess(shell) : !emptyStartup) continue;
      fs.rmSync(dir, { recursive: true }); removed.push(sessionId);
    } catch { /* Unknown identities and damaged records are retained. */ }
  }
  return removed;
}
module.exports = { cleanupSessions };
