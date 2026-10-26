"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { durableWrite, privateJSON, syncDirectory } = require("./task-store.cjs");
const { operationId, normalizeTask, requestHash } = require("./task-spec.cjs");
const { jobHash } = require("./task-jobs.cjs");
const { ownedRunner, processIdentity } = require("./task-process.cjs");
const FINAL = new Set(["completed", "failed", "cancelled", "unknown"]);
function failure(code, message, retryable = false) {
  return Object.assign(Error(message), { code, retryable });
}
class TaskManager {
  constructor({ dir, deviceId, bootId, authorized, spawn = cp.spawn, processIdentityProvider = processIdentity, scheduler = null }) {
    this.dir = folder(path.resolve(dir));
    this.deviceId = operationId(deviceId);
    this.bootId = bootId;
    this.authorized = authorized;
    this.spawn = spawn;
    this.identityAvailable = !!processIdentityProvider(process.pid);
    this.records = new Map();
    this.active = new Set();
    this.corrupt = new Set();
    this.stopping = false;
    this.recover();
    this.scheduler = scheduler;
    if (scheduler) scheduler.register("task", { snapshot: () => this.executionSnapshot(), start: request => this.startScheduled(request.key) });
  }
  directory(key) { return path.join(this.dir, operationId(key)); }
  file(key, name) { return path.join(this.directory(key), name); }
  save(record) { durableWrite(this.file(record.operationId, "manifest.json"), record); }
  validate(record, key) {
    if (!record || record.operationId !== key || record.deviceId !== this.deviceId ||
        (!["exec", "job"].includes(record.kind) &&
          !(record.kind === "cancelled" && record.cancelledBeforeSubmit)) ||
        (!/^[a-f0-9]{64}$/.test(record.requestHash) &&
          !(record.cancelledBeforeSubmit && record.requestHash === null)) ||
        !["accepted", "starting", "running", ...FINAL].includes(record.state))
      throw failure("OPERATION_CORRUPT", "Operation manifest is invalid");
    operationId(record.owner);
    return record;
  }
  recover() {
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      try {
        const directory = this.directory(name), stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Invalid operation directory");
        const record = this.validate(privateJSON(this.file(name, "manifest.json")), name);
        this.records.set(name, record);
        const result = this.result(record);
        if (result) {
          record.state = result.state; record.updatedAt = result.finishedAt; this.save(record); continue;
        }
        if (FINAL.has(record.state) && record.state !== "unknown") {
          this.unknown(record, "RESULT_MISSING", false);
          continue;
        }
        if (record.state === "accepted") {
          const input = privateJSON(this.file(name, "input.json"));
          if (!input || requestHash(this.deviceId, record.kind, input.spec) !== record.requestHash ||
              fs.existsSync(this.file(name, "execution.lock")))
            this.unknown(record, "ACCEPTED_INPUT_INCOMPLETE", false);
        } else if (record.state === "starting" || record.state === "running") {
          const runner = privateJSON(this.file(name, "runner.json"), null);
          this.active.add(name);
          if (runner && ownedRunner(runner, directory)) {
            record.state = "running"; this.save(record);
          } else if (record.state === "starting" && !runner && Number.isFinite(record.launchAt) &&
              Date.now() >= record.launchAt && Date.now() - record.launchAt <= 30000) {
            // Report uncertainty while the original process initializes. Do
            // not overwrite its startup intent or spawn a replacement.
            record.state = "unknown"; record.errorCode = "RUNNER_IDENTITY_UNCONFIRMED";
            record.reserveSlot = true;
          } else this.unknown(record, "RUNNER_IDENTITY_UNCONFIRMED", true);
        } else if (record.state === "unknown" && record.reserveSlot) this.active.add(name);
      } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:79}); this.corrupt.add(name); this.active.add(name); }
    }
  }
  result(record) {
    const result = privateJSON(this.file(record.operationId, "result.json"), null);
    if (!result) return null;
    if (result.operationId !== record.operationId || result.owner !== record.owner ||
        !FINAL.has(result.state) || (result.exitCode !== null && !Number.isInteger(result.exitCode)))
      throw failure("OPERATION_CORRUPT", "Operation result is invalid");
    return result;
  }
  unknown(record, code, reserveSlot) {
    record.state = "unknown"; record.errorCode = code; record.reserveSlot = reserveSlot;
    record.updatedAt = Date.now(); this.save(record);
    if (!reserveSlot) this.active.delete(record.operationId);
  }
  lookup(owner, key, allowRevoked = false) {
    operationId(owner); operationId(key);
    if (!allowRevoked && !this.authorized(owner))
      throw failure("AUTH_REVOKED", "Controller authorization is no longer valid");
    const record = this.records.get(key);
    if (!record || record.owner !== owner) throw failure("OPERATION_NOT_FOUND", "Operation is not available to this controller");
    if (this.corrupt.has(key)) throw failure("OPERATION_CORRUPT", "Operation record is isolated; outcome is unknown");
    return record;
  }
  submit(owner, params) {
    if (this.stopping) throw failure("AGENT_STOPPING", "Far Agent is stopping", true);
    operationId(owner);
    if (!this.authorized(owner)) throw failure("AUTH_REVOKED", "Controller authorization is no longer valid");
    const key = operationId(params.operationId), kind = params.kind;
    const spec = normalizeTask(kind, params.spec);
    const hash = requestHash(this.deviceId, kind, spec);
    if (params.requestHash !== undefined && params.requestHash !== hash)
      throw failure("REQUEST_HASH_MISMATCH", "Task request hash does not match normalized input");
    if (this.records.has(key)) {
      const record = this.lookup(owner, key);
      if (record.cancelledBeforeSubmit && record.requestHash === null) {
        record.requestHash = hash; record.kind = kind; this.save(record);
      }
      if (record.requestHash !== hash) throw failure("REQUEST_CONFLICT", "operationId was used for different task input");
      return this.get(owner, { operationId: key });
    }
    if (this.corrupt.has(key)) throw failure("OPERATION_CORRUPT", "Operation record is isolated; outcome is unknown");
    if (!this.identityAvailable)
      throw failure("PROCESS_IDENTITY_UNAVAILABLE", "This runtime cannot prove process identity; persistent execution is unavailable");
    if (kind === "job") {
      let actual;
      try { actual = jobHash(spec.name); }
      catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:127});
        if (error.code === "ENOENT") throw failure("JOB_MODULE_MISSING", "Controlled job module is not installed on the target");
        throw error;
      }
      if (actual !== spec.sourceHash)
        throw failure("JOB_VERSION_MISMATCH", "Controlled job version differs from the requested module");
    }
    if (this.records.size + this.corrupt.size >= 10000 ||
        (this.scheduler && this.scheduler.pendingCount() >= this.scheduler.queueLimit) ||
        [...this.records.values()].filter(record => record.state === "accepted").length >= 64)
      throw failure("TASK_CAPACITY", "Task queue or retained record capacity reached", true);
    const directory = this.directory(key);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:140});
      if (error.code === "EEXIST") throw failure("OPERATION_CORRUPT", "Existing operation directory has no valid manifest");
      throw error;
    }
    const record = { schemaVersion: 1, operationId: key, owner, deviceId: this.deviceId,
      requestHash: hash, kind, state: "accepted", createdAt: Date.now(), updatedAt: Date.now(),
      durability: { fileFsync: true, directoryFsync: syncDirectory(this.dir) && syncDirectory(directory) } };
    this.save(record);
    this.records.set(key, record);
    try { durableWrite(this.file(key, "input.json"), { spec }); }
    catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:150}); this.unknown(record, "INPUT_STORAGE_FAILED", false); throw error; }
    this.tick();
    return this.get(owner, { operationId: key });
  }
  start(record) {
    const key = record.operationId;
    record.state = "starting"; record.agentBootId = this.bootId; record.launchAt = Date.now();
    record.updatedAt = Date.now(); this.save(record); this.active.add(key);
    let spawned = false, child;
    try {
      child = this.spawn(process.execPath, [path.join(__dirname, "task-runner.cjs"), this.directory(key)],
        { detached: true, windowsHide: true, stdio: "ignore",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      child.once("spawn", () => { spawned = true; child.unref(); });
      child.once("error", () => {
        try {
          if (!spawned) this.finishBeforeStart(record, "failed", "RUNNER_SPAWN_FAILED");
          else this.unknown(record, "RUNNER_PROCESS_ERROR", true);
        } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:168}); this.corrupt.add(key); }
      });
      child.once("close", () => {
        try {
          if (!this.result(record) && !FINAL.has(record.state))
            this.unknown(record, "RUNNER_EXIT_WITHOUT_RESULT", true);
        } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:174}); this.corrupt.add(key); }
      });
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:176}); this.finishBeforeStart(record, "failed", "RUNNER_SPAWN_FAILED"); }
  }
  executionSnapshot() {
    return { active: this.active.size, queued: !this.identityAvailable || this.stopping ? [] :
      [...this.records.values()].filter(record => record.state === "accepted").map(record => ({ key: record.operationId, createdAt: record.createdAt })) };
  }
  startScheduled(key) {
    const record = this.records.get(key);
    if (!record || record.state !== "accepted" || !this.identityAvailable || this.stopping) return false;
    if (!this.authorized(record.owner)) { this.finishBeforeStart(record, "cancelled", "AUTH_REVOKED"); return false; }
    try { this.start(record); return this.active.has(key); }
    catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:187});
      if (error.code !== "TASK_DISK_CAPACITY") {
        try { this.unknown(record, "TASK_START_FAILED", false); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:189}); this.corrupt.add(key); }
      }
      return false;
    }
  }
  tick() {
    if (this.stopping) return;
    for (const key of [...this.active]) {
      const record = this.records.get(key);
      if (!record || this.corrupt.has(key)) continue;
      try {
        if (!this.authorized(record.owner))
          this.cancel(record.owner, { operationId: key, requestId: crypto.randomUUID() }, true);
        const result = this.result(record);
        if (result) {
          record.state = result.state; record.updatedAt = result.finishedAt;
          record.reserveSlot = false; this.save(record); this.active.delete(key);
          continue;
        }
        const runner = privateJSON(this.file(key, "runner.json"), null);
        if (runner?.heartbeatAt && Date.now() - runner.heartbeatAt <= 30000 && record.state === "starting")
          record.state = "running";
        if (!FINAL.has(record.state) && Date.now() - (runner?.heartbeatAt || record.launchAt || 0) > 30000)
          this.unknown(record, "RUNNER_HEARTBEAT_LOST", true);
      } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:213}); this.corrupt.add(key); }
    }
    if (this.scheduler) { this.scheduler.tick(); return; }
    if (this.active.size >= 2 || !this.identityAvailable) return;
    const queued = [...this.records.values()].filter(record => record.state === "accepted")
      .sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId));
    for (const record of queued) {
      if (this.active.size >= 2) break;
      if (!this.authorized(record.owner)) { this.finishBeforeStart(record, "cancelled", "AUTH_REVOKED"); continue; }
      try { this.start(record); }
      catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:223});
        if (error.code === "TASK_DISK_CAPACITY") break;
        try { this.unknown(record, "TASK_START_FAILED", false); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:225}); this.corrupt.add(record.operationId); }
      }
    }
  }
  page(key, name, offset, limit) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw failure("INVALID_OFFSET", "Output offset must be a nonnegative safe integer");
    const file = this.file(key, name + ".bin");
    let fd;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw failure("OPERATION_CORRUPT", "Output file is invalid");
      if (offset > stat.size) throw failure("INVALID_OFFSET", "Output offset exceeds stored bytes");
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const bytes = Buffer.alloc(Math.min(limit, stat.size - offset));
      const count = fs.readSync(fd, bytes, 0, bytes.length, offset);
      return { data: bytes.subarray(0, count).toString("base64"), nextOffset: offset + count, storedBytes: stat.size };
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:241});
      if (error.code === "ENOENT" && offset === 0) return { data: "", nextOffset: 0, storedBytes: 0 };
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  get(owner, params, allowRevoked = false) {
    const record = this.lookup(owner, params.operationId, allowRevoked), key = record.operationId;
    const limit = params.limitBytes ?? 65536;
    if (!Number.isInteger(limit) || limit < 1 || limit > 65536)
      throw failure("INVALID_LIMIT", "Output page limit must be between 1 and 65536 bytes");
    const result = this.result(record);
    if (!result && FINAL.has(record.state) && record.state !== "unknown")
      throw failure("OPERATION_CORRUPT", "Final operation result is missing");
    return { operationId: key, deviceId: this.deviceId, state: result?.state || record.state,
      kind: record.kind, createdAt: record.createdAt, errorCode: result ? result.errorCode || null : record.errorCode || null,
      result: result ? { exitCode: result.exitCode, signal: result.signal, finishedAt: result.finishedAt,
        cancelRequested: result.cancelRequested, cancellationError: result.cancellationError,
        stdout: result.stdout, stderr: result.stderr } : null,
      stdout: this.page(key, "stdout", params.stdoutOffset ?? 0, limit),
      stderr: this.page(key, "stderr", params.stderrOffset ?? 0, limit),
      outputEncoding: "base64", durability: record.durability };
  }
  finishBeforeStart(record, state, errorCode) {
    const finishedAt = Date.now();
    durableWrite(this.file(record.operationId, "result.json"), {
      operationId: record.operationId, owner: record.owner, state, errorCode, exitCode: null, signal: null, finishedAt,
      stdout: { bytes: 0, totalBytes: 0, truncated: false }, stderr: { bytes: 0, totalBytes: 0, truncated: false },
    });
    record.state = state; record.updatedAt = finishedAt; this.save(record); this.active.delete(record.operationId);
    try { fs.unlinkSync(this.file(record.operationId, "input.json")); } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'tasks.cjs',line:270}); if (error.code !== "ENOENT") throw error; }
  }
  cancel(owner, params, allowRevoked = false) {
    operationId(owner); operationId(params.operationId); operationId(params.requestId);
    if (!this.records.has(params.operationId) && !this.corrupt.has(params.operationId)) {
      if (!allowRevoked && !this.authorized(owner)) throw failure("AUTH_REVOKED", "Controller authorization is no longer valid");
        if (this.records.size + this.corrupt.size >= 10000)
        throw failure("TASK_CAPACITY", "Task cancellation record capacity reached", true);
      const key = params.operationId, directory = this.directory(key);
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:280}); throw failure("OPERATION_CORRUPT", "Unrecognized operation directory cannot be replaced"); }
      const record = { schemaVersion: 1, operationId: key, owner, deviceId: this.deviceId,
        kind: "cancelled", requestHash: null, cancelledBeforeSubmit: true, state: "accepted",
        createdAt: Date.now(), updatedAt: Date.now(),
        durability: { fileFsync: true, directoryFsync: syncDirectory(this.dir) && syncDirectory(directory) } };
      this.save(record); this.records.set(key, record);
      this.finishBeforeStart(record, "cancelled", "CANCELLED_BEFORE_SUBMIT");
      return this.get(owner, { operationId: key }, allowRevoked);
    }
    const record = this.lookup(owner, params.operationId, allowRevoked);
    const requestId = operationId(params.requestId), key = record.operationId;
    if (this.result(record)) return this.get(owner, { operationId: key }, allowRevoked);
    if (FINAL.has(record.state)) {
      if (record.state !== "unknown") return this.get(owner, { operationId: key }, allowRevoked);
    }
    if (record.state === "accepted") {
      this.finishBeforeStart(record, "cancelled", null);
      return this.get(owner, { operationId: key }, allowRevoked);
    }
    const previous = privateJSON(this.file(key, "cancel.json"), null);
    if (!previous) durableWrite(this.file(key, "cancel.json"), { owner, requestId, requestedAt: Date.now() });
    return { operationId: key, state: record.state === "unknown" ? "unknown" : "cancel_requested",
      cancelRequested: true };
  }
  revoke(owner) {
    const results = [];
    for (const record of this.records.values()) {
      if (record.owner !== owner || (FINAL.has(record.state) && record.state !== "unknown")) continue;
      try { results.push(this.cancel(owner, { operationId: record.operationId, requestId: crypto.randomUUID() }, true)); }
      catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'tasks.cjs',line:309}); results.push({ operationId: record.operationId, state: "unknown", cancelRequested: false }); }
    }
    return results;
  }
  handle(owner, method, params) {
    if (method === "submit") return this.submit(owner, params);
    if (method === "get") return this.get(owner, params);
    if (method === "cancel") return this.cancel(owner, params);
    throw failure("CONTROL_UNSUPPORTED_METHOD", "Control method is not available");
  }
  close() { this.stopping = true; }
}
module.exports = { TaskManager, FINAL };
