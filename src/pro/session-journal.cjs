"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { operationId, normalizeSpec } = require("./task-spec.cjs");
const { durableWrite, privateJSON, syncDirectory } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
// Private command journal only. This module does not create or recover a shell.
class SessionJournal {
  constructor({ dir, deviceId, sessionId, owner, platform, osBoot }) {
    this.dir = folder(path.resolve(dir));
    this.deviceId = operationId(deviceId); this.sessionId = operationId(sessionId);
    this.owner = operationId(owner); this.platform = platform; this.osBoot = osBoot;
    if (!["linux", "windows"].includes(platform) || typeof osBoot !== "string" || !osBoot)
      throw failure("SESSION_INVALID", "A verified session platform and system boot identity are required");
    this.commands = folder(path.join(this.dir, "commands"));
    this.manifest = path.join(this.dir, "manifest.json");
    const previous = privateJSON(this.manifest, null);
    if (previous) {
      if (previous.sessionId !== sessionId || previous.deviceId !== deviceId || previous.owner !== owner ||
          previous.platform !== platform) throw failure("SESSION_CONFLICT", "Session identity differs from its saved journal");
      this.record = previous;
      this.recover();
    } else {
      if (fs.readdirSync(this.commands).length) throw failure("SESSION_CORRUPT", "Session manifest is missing");
      this.record = { schemaVersion: 1, sessionId, deviceId, owner, platform, osBoot,
        state: "open", nextSequence: 1, activeRequestId: null, createdAt: Date.now() };
      this.save();
    }
  }
  save() { durableWrite(this.manifest, this.record); }
  checkOwner(owner) {
    if (owner !== this.owner) throw failure("SESSION_NOT_FOUND", "Unknown session");
  }
  directory(requestId) { return path.join(this.commands, operationId(requestId)); }
  file(requestId, name) { return path.join(this.directory(requestId), name); }
  read(requestId) {
    const record = privateJSON(this.file(requestId, "manifest.json"), null);
    if (!record) throw failure("SESSION_REQUEST_NOT_FOUND", "Unknown session command request");
    if (record.requestId !== requestId || record.sessionId !== this.sessionId || record.owner !== this.owner ||
        !Number.isInteger(record.sequence) || record.sequence < 1 || !/^[a-f0-9]{64}$/.test(record.requestHash) ||
        !["accepted", "running", "completed", "failed", "unknown"].includes(record.state))
      throw failure("SESSION_CORRUPT", "Session command metadata is invalid");
    return record;
  }
  public(record) {
    return { sessionId: this.sessionId, requestId: record.requestId, sequence: record.sequence,
      state: record.state, completed: ["completed", "failed"].includes(record.state) };
  }
  hash(sequence, spec) {
    return crypto.createHash("sha256").update(JSON.stringify({ deviceId: this.deviceId,
      sessionId: this.sessionId, sequence, spec })).digest("hex");
  }
  recover() {
    if (!Number.isInteger(this.record.nextSequence) || this.record.nextSequence < 1 ||
        !["open", "busy", "unknown", "lost", "closed"].includes(this.record.state))
      throw failure("SESSION_CORRUPT", "Session journal metadata is invalid");
    const sequences = new Set(); let max = 0, unresolved = false;
    for (const id of fs.readdirSync(this.commands)) {
      operationId(id);
      const command = this.read(id);
      if (sequences.has(command.sequence)) throw failure("SESSION_CORRUPT", "Session command sequence is duplicated");
      sequences.add(command.sequence); max = Math.max(max, command.sequence);
      const result = privateJSON(this.file(id, "result.json"), null);
      if (result) {
        this.validateResult(command, result);
        command.state = result.state;
      } else if (!["completed", "failed"].includes(command.state)) {
        command.state = "unknown"; unresolved = true;
      } else { command.state = "unknown"; unresolved = true; }
      durableWrite(this.file(id, "manifest.json"), command);
    }
    if (max !== sequences.size) throw failure("SESSION_CORRUPT", "Session command sequence contains a gap");
    this.record.nextSequence = max + 1; this.record.activeRequestId = null;
    // Even completed commands do not prove that the original shell survived.
    if (this.record.osBoot !== this.osBoot) this.record.state = "lost";
    else if (this.record.state !== "closed") this.record.state = "unknown";
    this.record.unresolvedCommands = unresolved; this.save();
  }
  accept(owner, { requestId, sequence, spec }) {
    this.checkOwner(owner); operationId(requestId);
    const normalized = normalizeSpec(spec, this.platform);
    const hash = this.hash(sequence, normalized);
    if (fs.existsSync(this.file(requestId, "manifest.json"))) {
      const existing = this.read(requestId);
      if (existing.requestHash !== hash) throw failure("REQUEST_CONFLICT", "Session request ID was used for different command input");
      return this.public(existing);
    }
    if (this.record.state === "lost") throw failure("SESSION_LOST", "Original session system boot no longer exists");
    if (this.record.state !== "open") throw failure("SESSION_UNAVAILABLE", "Session is busy or its shell identity is unconfirmed");
    if (sequence !== this.record.nextSequence) throw failure("SESSION_SEQUENCE_CONFLICT", "Session command sequence is not the next expected value");
    if (sequence > 10000) throw failure("SESSION_CAPACITY", "Session command journal capacity reached");
    folder(this.directory(requestId));
    durableWrite(this.file(requestId, "input.json"), { spec: normalized });
    const record = { sessionId: this.sessionId, owner: this.owner, requestId, sequence,
      requestHash: hash, state: "accepted", createdAt: Date.now() };
    durableWrite(this.file(requestId, "manifest.json"), record);
    this.record.nextSequence++; this.record.activeRequestId = requestId; this.record.state = "busy"; this.save();
    return this.public(record);
  }
  claim(owner, requestId) {
    this.checkOwner(owner);
    const record = this.read(requestId);
    if (this.record.state !== "busy" || this.record.activeRequestId !== requestId || record.state !== "accepted")
      throw failure("SESSION_COMMAND_UNKNOWN", "Session command is not available for first execution");
    const input = privateJSON(this.file(requestId, "input.json"), null);
    if (!input || this.hash(record.sequence, normalizeSpec(input.spec, this.platform)) !== record.requestHash)
      throw failure("SESSION_CORRUPT", "Session command input differs from its saved request");
    let fd;
    try { fd = fs.openSync(this.file(requestId, "execution.lock"), "wx", 0o600); fs.fsyncSync(fd); }
    catch { throw failure("SESSION_COMMAND_UNKNOWN", "Session command may already have started"); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    syncDirectory(this.directory(requestId));
    record.state = "running"; durableWrite(this.file(requestId, "manifest.json"), record);
    return input;
  }
  validateResult(record, result) {
    if (result.requestId !== record.requestId || result.sessionId !== this.sessionId || result.owner !== this.owner ||
        !["completed", "failed"].includes(result.state) || !Number.isInteger(result.exitCode) ||
        !Number.isFinite(result.finishedAt)) throw failure("SESSION_CORRUPT", "Session command result is invalid");
  }
  complete(owner, requestId, { exitCode }) {
    this.checkOwner(owner); const record = this.read(requestId);
    if (record.state !== "running" || this.record.activeRequestId !== requestId || !Number.isInteger(exitCode))
      throw failure("SESSION_COMMAND_UNKNOWN", "Session command cannot be completed in its current state");
    const result = { requestId, sessionId: this.sessionId, owner: this.owner,
      state: exitCode === 0 ? "completed" : "failed", exitCode, finishedAt: Date.now() };
    durableWrite(this.file(requestId, "result.json"), result);
    record.state = result.state; durableWrite(this.file(requestId, "manifest.json"), record);
    this.record.activeRequestId = null; this.record.state = "open"; this.save();
    fs.rmSync(this.file(requestId, "input.json"), { force: true });
    return this.public(record);
  }
  get(owner, requestId) {
    this.checkOwner(owner); const record = this.read(requestId);
    const result = privateJSON(this.file(requestId, "result.json"), null);
    if (result) this.validateResult(record, result);
    const state = result ? result.state : ["completed", "failed"].includes(record.state) ? "unknown" : record.state;
    return { ...this.public({ ...record, state }), ...(result ? { result: { state: result.state, exitCode: result.exitCode, finishedAt: result.finishedAt } } : {}) };
  }
}
module.exports = { SessionJournal };
