"use strict";
const fs = require("node:fs"), path = require("node:path");
const { privateJSON, durableWrite } = require("./task-store.cjs");
const { operationId } = require("./task-spec.cjs");
const { processState } = require("./task-process.cjs");
class SessionExecutions {
  constructor(manager, { inspect = processState } = {}) { this.manager = manager; this.inspect = inspect; this.checked = new Map(); }
  gone(config, dir) {
    const previous = this.checked.get(config.sessionId);
    if (previous && Date.now() - previous.at < 30000) return previous.gone;
    const records = ["runner.json", "shell.json"].map(name => privateJSON(path.join(dir, name), null));
    const gone = records.every(record => record && record.sessionId === config.sessionId && record.owner === config.owner &&
      record.osBoot === config.osBoot && path.resolve(record.sessionDir || "") === path.resolve(dir) && this.inspect(record) === "exited");
    this.checked.set(config.sessionId, { at: Date.now(), gone }); return gone;
  }
  snapshot() {
    let active = 0; const queued = [], manager = this.manager;
    for (const sessionId of fs.readdirSync(manager.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(sessionId)) continue;
      const dir = path.join(manager.dir, sessionId);
      try {
        const config = privateJSON(path.join(dir, "session.json"), null);
        if (!config || config.deviceId !== manager.deviceId || config.sessionId !== sessionId) continue;
        operationId(config.owner);
        const manifest = privateJSON(path.join(dir, "manifest.json"), null);
        const permitFile = path.join(dir, "permit.json"); let permit = privateJSON(permitFile, null);
        if (permit) {
          operationId(permit.requestId);
          if (permit.sessionId !== sessionId || permit.owner !== config.owner || permit.deviceId !== manager.deviceId ||
              !/^[a-f0-9]{64}$/.test(permit.requestHash)) throw Error("Invalid session execution permit");
          const commandDir = path.join(dir, "commands", permit.requestId);
          const result = privateJSON(path.join(commandDir, "result.json"), null), receipt = privateJSON(path.join(dir, "responses", permit.requestId + ".json"), null);
          const final = result && result.sessionId === sessionId && result.requestId === permit.requestId && result.owner === config.owner &&
            ["completed", "failed"].includes(result.state) && Number.isInteger(result.exitCode) && Number.isFinite(result.finishedAt);
          const rejected = receipt?.sessionId === sessionId && receipt.requestId === permit.requestId && receipt.ok === false &&
            !fs.existsSync(path.join(commandDir, "execution.lock"));
          const stopped = (manifest?.state === "lost" || fs.existsSync(path.join(dir, "close.json")) ||
            Date.now() - permit.createdAt > 30000) && this.gone(config, dir);
          if (final || rejected || stopped) { fs.unlinkSync(permitFile); permit = null; }
          else active++;
        } else if (manifest?.state === "busy" || manifest?.unresolvedCommands) active++;
        if (config.executionBudgetVersion !== 1 || !manager.identityAvailable || !manager.authorized(config.owner) ||
            ["lost", "closed", "unknown"].includes(manifest?.state) || fs.existsSync(path.join(dir, "close.json")) || fs.existsSync(path.join(dir, "revoke.json"))) continue;
        for (const name of fs.readdirSync(path.join(dir, "inbox"))) {
          if (!/^[a-f0-9-]{36}\.json$/.test(name) || permit?.requestId === name.slice(0, -5)) continue;
          const requestId = operationId(name.slice(0, -5));
          if (fs.existsSync(path.join(dir, "responses", name)) || fs.existsSync(path.join(dir, "commands", requestId, "result.json"))) continue;
          const request = privateJSON(path.join(dir, "requests", name), null);
          if (!request || request.owner !== config.owner || request.sessionId !== sessionId || request.requestId !== requestId ||
              request.method !== "send" || !Number.isFinite(request.createdAt) || !/^[a-f0-9]{64}$/.test(request.requestHash)) throw Error("Invalid queued session request");
          queued.push({ key: sessionId + ":" + requestId, sessionId, requestId, createdAt: request.createdAt });
        }
      } catch { active++; }
    }
    return { active, queued };
  }
  start(request) {
    const manager = this.manager, { dir, config } = manager.lookup(manager.ownerForSession(request.sessionId), request.sessionId);
    if (config.executionBudgetVersion !== 1 || fs.existsSync(path.join(dir, "permit.json")) ||
        fs.existsSync(path.join(dir, "close.json")) || fs.existsSync(path.join(dir, "revoke.json"))) return false;
    const manifest = privateJSON(path.join(dir, "manifest.json"), null);
    if (!manifest || manifest.state !== "open") return false;
    const record = privateJSON(path.join(dir, "requests", operationId(request.requestId) + ".json"), null);
    if (!record || record.owner !== config.owner || record.sessionId !== config.sessionId || record.requestId !== request.requestId ||
        record.method !== "send" || !/^[a-f0-9]{64}$/.test(record.requestHash) || !fs.existsSync(path.join(dir, "inbox", request.requestId + ".json"))) return false;
    durableWrite(path.join(dir, "permit.json"), { sessionId: config.sessionId, owner: config.owner, deviceId: manager.deviceId,
      requestId: request.requestId, requestHash: record.requestHash, createdAt: Date.now() });
    return true;
  }
}
module.exports = { SessionExecutions };
