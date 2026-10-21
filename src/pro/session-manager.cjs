"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const { folder, systemBootId } = require("./store.cjs");
const { operationId, normalizeSpec } = require("./task-spec.cjs");
const { processIdentity, ownedSessionRunner } = require("./task-process.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
const { SessionReader } = require("./session-reader.cjs");
const { normalizeSessionRequest } = require("./session-spec.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
// Far-side owner-bound service reached through authenticated control RPC.
class SessionManager {
  constructor({ dir, deviceId, authorized, spawn = cp.spawn, identity = processIdentity,
    runnerLive = ownedSessionRunner, osBoot = systemBootId(), platform = process.platform === "win32" ? "windows" : "linux" }) {
    this.dir = folder(path.resolve(dir)); this.deviceId = operationId(deviceId); this.authorized = authorized;
    this.spawn = spawn; this.identityAvailable = !!identity(process.pid); this.osBoot = osBoot; this.platform = platform;
    this.reader = new SessionReader({ dir: this.dir, deviceId, authorized, osBoot, runnerLive });
    this.reconcileAuthorization();
  }
  check(owner) {
    operationId(owner);
    if (typeof this.authorized !== "function" || !this.authorized(owner)) throw failure("AUTH_REVOKED", "Session controller authorization is unavailable");
  }
  directory(sessionId) { return path.join(this.dir, operationId(sessionId)); }
  lookup(owner, sessionId) {
    this.check(owner); const dir = this.directory(sessionId), config = privateJSON(path.join(dir, "session.json"), null);
    if (!config || config.owner !== owner || config.sessionId !== sessionId || config.deviceId !== this.deviceId)
      throw failure("SESSION_NOT_FOUND", "Unknown session");
    if (config.schemaVersion !== 1 || !["linux", "windows"].includes(config.platform) ||
        !Number.isFinite(config.createdAt) || typeof config.osBoot !== "string" || !config.osBoot ||
        !/^[a-f0-9]{64}$/.test(config.requestHash)) throw failure("SESSION_CORRUPT", "Session startup metadata is invalid");
    return { dir, config };
  }
  create(owner, { sessionId, cwd = null }) {
    this.check(owner); operationId(sessionId);
    const normalized = normalizeSpec({ command: "true", cwd }, this.platform);
    const requestHash = hash({ deviceId: this.deviceId, platform: this.platform, cwd: normalized.cwd });
    const dir = this.directory(sessionId), file = path.join(dir, "session.json");
    if (fs.existsSync(file)) {
      if (this.lookup(owner, sessionId).config.requestHash !== requestHash) throw failure("REQUEST_CONFLICT", "Session ID was used for different startup input");
      return this.status(owner, sessionId);
    }
    if (!this.identityAvailable || !this.osBoot) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Session process identity cannot be verified");
    if (fs.readdirSync(this.dir).length >= 64) throw failure("SESSION_CAPACITY", "Session record capacity reached");
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch { throw failure("SESSION_CORRUPT", "Existing session directory cannot be replaced"); }
    durableWrite(file, { schemaVersion: 1, sessionId, owner, deviceId: this.deviceId, platform: this.platform,
      osBoot: this.osBoot, cwd: normalized.cwd, requestHash, createdAt: Date.now() });
    folder(path.join(dir, "inbox")); folder(path.join(dir, "requests"));
    const spawnFailed = () => { try { durableWrite(path.join(dir, "runner-error.json"), { errorCode: "SESSION_RUNNER_SPAWN_FAILED", finishedAt: Date.now() }); } catch {} };
    try {
      const child = this.spawn(process.execPath, [path.join(__dirname, "session-runner.cjs"), dir],
        { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      child.once("error", spawnFailed); child.unref();
    } catch { spawnFailed(); }
    return this.status(owner, sessionId);
  }
  status(owner, sessionId) {
    const { dir, config } = this.lookup(owner, sessionId);
    if (fs.existsSync(path.join(dir, "manifest.json"))) return this.reader.get(owner, { sessionId });
    const error = privateJSON(path.join(dir, "runner-error.json"), null);
    return { sessionId, deviceId: this.deviceId, state: !this.osBoot ? "unknown" : config.osBoot !== this.osBoot ? "lost" :
      error || Date.now() - config.createdAt >= 20000 ? "unknown" : "starting", shellAlive: false,
      errorCode: error ? "SESSION_RUNNER_UNAVAILABLE" : null };
  }
  request(owner, { sessionId, requestId, sequence, spec, method = "send" }) {
    const { dir } = this.lookup(owner, sessionId); operationId(requestId);
    const normalizedRequest = normalizeSessionRequest({ sessionId, requestId, sequence, spec, method }, this.platform);
    const normalized = normalizedRequest.spec, requestHash = normalizedRequest.requestHash;
    const file = path.join(dir, "requests", requestId + ".json"), existing = privateJSON(file, null);
    if (existing) {
      if (existing.requestHash !== requestHash || existing.owner !== owner) throw failure("REQUEST_CONFLICT", "Session request ID was used for different input");
      return this.queryRequest(owner, { sessionId, requestId });
    }
    const closeFile = path.join(dir, "close.json");
    if (method === "send" && (fs.existsSync(closeFile) || fs.existsSync(path.join(dir, "revoke.json"))))
      throw failure("SESSION_UNAVAILABLE", "Session is closing or its controller was revoked");
    if (method === "send" && !this.status(owner, sessionId).shellAlive) throw failure("SESSION_UNAVAILABLE", "Original session runner identity is not confirmed");
    if (method === "close" && fs.existsSync(closeFile)) throw failure("SESSION_CLOSE_PENDING", "Query the original session close request before retrying");
    if ((method === "send" && fs.readdirSync(path.join(dir, "inbox")).length >= 64) ||
        fs.readdirSync(path.join(dir, "requests")).length >= (method === "close" ? 10001 : 10000))
      throw failure("SESSION_CAPACITY", "Session request capacity reached");
    // Save intent before the only inbox publication. Duplicates only query.
    const record = { owner, sessionId, requestId, requestHash, method, state: "prepared", createdAt: Date.now() };
    durableWrite(file, record);
    if (method === "close") durableWrite(closeFile, { sessionId, owner, requestId, createdAt: Date.now() });
    else durableWrite(path.join(dir, "inbox", requestId + ".json"), { sessionId, requestId, method,
      params: { requestId, sequence, spec: normalized } });
    record.state = "submitted"; durableWrite(file, record);
    return { sessionId, deviceId: this.deviceId, requestId, state: "submitted", completed: false };
  }
  queryRequest(owner, { sessionId, requestId, ...paging }) {
    const { dir } = this.lookup(owner, sessionId); operationId(requestId);
    const record = privateJSON(path.join(dir, "requests", requestId + ".json"), null);
    if (!record || record.owner !== owner || record.sessionId !== sessionId || record.requestId !== requestId)
      throw failure("SESSION_REQUEST_NOT_FOUND", "Unknown session command request");
    const receipt = privateJSON(path.join(dir, "responses", requestId + ".json"), null);
    if (receipt && (receipt.sessionId !== sessionId || receipt.requestId !== requestId)) throw failure("SESSION_CORRUPT", "Session response identity differs from request");
    if (record.method === "send" && fs.existsSync(path.join(dir, "commands", requestId, "manifest.json")))
      return this.reader.get(owner, { sessionId, requestId, ...paging });
    if (receipt && record.method === "close" && receipt.ok === true && receipt.state === "lost")
      return { sessionId, deviceId: this.deviceId, requestId, state: "lost", completed: true, stopRequested: true };
    if (receipt) return { sessionId, deviceId: this.deviceId, requestId, state: "unknown", completed: false, errorCode: receipt.ok ? null : "SESSION_REQUEST_REJECTED" };
    const inboxPresent = fs.existsSync(record.method === "close" ? path.join(dir, "close.json") : path.join(dir, "inbox", requestId + ".json"));
    return { sessionId, deviceId: this.deviceId, requestId, state: record.state === "prepared" || !inboxPresent ||
      !this.status(owner, sessionId).shellAlive ? "unknown" : "pending", completed: false };
  }
  revoke(owner) {
    operationId(owner);
    const results = [];
    for (const sessionId of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(sessionId)) continue;
      const dir = this.directory(sessionId);
      let owned = false;
      try {
        const config = privateJSON(path.join(dir, "session.json"), null);
        if (!config || config.owner !== owner || config.deviceId !== this.deviceId) continue;
        owned = true;
        const file = path.join(dir, "revoke.json"), existing = privateJSON(file, null);
        if (existing && (existing.owner !== owner || existing.sessionId !== sessionId))
          throw failure("SESSION_CORRUPT", "Session revocation identity is invalid");
        const record = existing || { owner, sessionId, requestId: crypto.randomUUID(), createdAt: Date.now() };
        operationId(record.requestId);
        if (!existing) durableWrite(file, record);
        results.push({ sessionId, requestId: record.requestId, state: "close_requested" });
      } catch { if (owned) results.push({ sessionId, state: "unknown", errorCode: "SESSION_REVOCATION_FAILED" }); }
    }
    return results;
  }
  reconcileAuthorization() {
    const owners = new Set();
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      try {
        const config = privateJSON(path.join(this.dir, name, "session.json"), null);
        if (config?.deviceId === this.deviceId) owners.add(operationId(config.owner));
      } catch {}
    }
    const results = [];
    for (const owner of owners) if (typeof this.authorized !== "function" || !this.authorized(owner))
      results.push(...this.revoke(owner));
    return results;
  }
  tick() {
    if (Date.now() - (this.lastAuthorizationCheck || 0) < 2000) return;
    this.lastAuthorizationCheck = Date.now(); this.reconcileAuthorization();
  }
  handle(owner, method, params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) throw failure("SESSION_INVALID", "Session parameters must be an object");
    switch (method) {
      case "session.create": return this.create(owner, params);
      case "session.status": return this.status(owner, params.sessionId);
      case "session.send": return this.request(owner, { ...params, method: "send" });
      case "session.get": return this.queryRequest(owner, params);
      case "session.close": return this.request(owner, { ...params, method: "close" });
      default: throw failure("SESSION_INVALID", "Unknown session control method");
    }
  }
}
module.exports = { SessionManager };
