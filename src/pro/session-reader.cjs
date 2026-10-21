"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { SessionJournal } = require("./session-journal.cjs");
const { SessionLog } = require("./session-log.cjs");
const { operationId } = require("./task-spec.cjs");
const { ownedSessionRunner } = require("./task-process.cjs");
const { systemBootId } = require("./store.cjs");
const { privateJSON } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
class SessionReader {
  constructor({ dir, deviceId, authorized, osBoot = systemBootId(), runnerLive = ownedSessionRunner }) {
    this.dir = path.resolve(dir); this.deviceId = operationId(deviceId);
    this.authorized = authorized; this.osBoot = osBoot; this.runnerLive = runnerLive;
  }
  lookup(owner, sessionId) {
    operationId(owner); operationId(sessionId);
    if (typeof this.authorized !== "function" || !this.authorized(owner))
      throw failure("AUTH_REVOKED", "Session controller authorization is unavailable");
    const dir = path.join(this.dir, sessionId);
    const config = privateJSON(path.join(dir, "session.json"), null);
    if (!config || config.owner !== owner || config.deviceId !== this.deviceId || config.sessionId !== sessionId)
      throw failure("SESSION_NOT_FOUND", "Unknown session");
    const journal = SessionJournal.reader({ dir, owner, sessionId, deviceId: this.deviceId });
    const runner = privateJSON(path.join(dir, "runner.json"), null);
    const bootKnown = typeof this.osBoot === "string" && !!this.osBoot;
    const lost = (bootKnown && config.osBoot !== this.osBoot) || journal.record.state === "lost" || journal.record.state === "closed";
    const live = bootKnown && !lost && runner?.sessionId === sessionId && runner.owner === owner && this.runnerLive(runner, dir);
    return { dir, journal, state: lost ? "lost" : live ? journal.record.state : "unknown" };
  }
  get(owner, { sessionId, requestId, stdoutOffset = 0, stderrOffset = 0, limitBytes = 65536 }) {
    const session = this.lookup(owner, sessionId);
    if (!requestId) return { sessionId, deviceId: this.deviceId, state: session.state,
      shellAlive: !["unknown", "lost", "closed"].includes(session.state),
      nextSequence: session.journal.record.nextSequence };
    const command = session.journal.get(owner, operationId(requestId));
    const directory = session.journal.directory(requestId);
    const page = (name, offset) => {
      if (!command.completed && offset === 0 && !fs.existsSync(path.join(directory, name + ".bin")))
        return { data: "", nextOffset: 0, storedBytes: 0, outputEncoding: "base64" };
      return SessionLog.page(directory, name, offset, limitBytes);
    };
    if (!Number.isInteger(limitBytes) || limitBytes < 1 || limitBytes > 65536)
      throw failure("INVALID_SESSION_CURSOR", "Invalid session output page size");
    return { ...command, deviceId: this.deviceId, sessionState: session.state,
      stdout: page("stdout", stdoutOffset), stderr: page("stderr", stderrOffset), outputEncoding: "base64" };
  }
}
module.exports = { SessionReader };
