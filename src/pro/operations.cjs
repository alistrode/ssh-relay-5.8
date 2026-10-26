"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { durableWrite, privateJSON } = require("./task-store.cjs");
const { agentControl } = require("./agent-control.cjs");
const { validateTaskPage, publicFailure } = require("./task-result.cjs");
const { OperationWorkflows } = require("./operation-workflows.cjs");
const { OperationGroups } = require("./operation-groups.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
class Operations {
  constructor(agent, { control = agentControl } = {}) {
    this.agent = agent; this.dir = folder(agent.file("operations")); this.control = control;
    this.groups = new OperationGroups(this);
    this.workflows = new OperationWorkflows(this);
  }
  exists(key) { return fs.existsSync(this.file(key)); }
  file(key) { return path.join(this.dir, operationId(key), "manifest.json"); }
  record(key) {
    const record = privateJSON(this.file(key), null);
    if (!record) throw failure("OPERATION_NOT_FOUND", "Unknown local operation");
    if (record.operationId !== key || record.profileId !== this.agent.identity.deviceId ||
        !/^[a-f0-9]{64}$/.test(record.requestHash) || !["exec", "job"].includes(record.kind) ||
        !["registered", "dispatching", "not_started", "accepted", "starting", "running", "completed", "failed", "cancelled", "unknown"].includes(record.state) ||
        !Number.isFinite(record.createdAt))
      throw failure("OPERATION_CORRUPT", "Local operation record is invalid");
    operationId(record.deviceId); operationId(record.childOperationId);
    return record;
  }
  public(record) {
    return { operationId: record.operationId, deviceId: record.deviceId,
      childOperationId: record.childOperationId, state: record.state, kind: record.kind,
      groupOperationId: record.groupOperationId,
      createdAt: record.createdAt, observedAt: record.observedAt || null };
  }
  register(params) {
    if (params.kind === "workflow") return this.workflows.register(params);
    if (this.workflows.exists(params.operationId)) throw failure("REQUEST_CONFLICT", "Operation ID belongs to a workflow");
    if (params.kind === "exec-group") return this.groups.register(params);
    const key = operationId(params.operationId), deviceId = operationId(params.deviceId);
    if (this.groups.exists(key)) throw failure("REQUEST_CONFLICT", "Operation ID belongs to a group");
    const childOperationId = operationId(params.childOperationId);
    if (!["exec", "job"].includes(params.kind) || !/^[a-f0-9]{64}$/.test(params.requestHash))
      throw failure("INVALID_REQUEST", "Invalid local task metadata");
    if (!this.agent.registry()[deviceId]) throw failure("DEVICE_NOT_FOUND", "Unknown paired device");
    const existing = privateJSON(this.file(key), null);
    if (existing) {
      const record = this.record(key);
      if (record.deviceId !== deviceId || record.childOperationId !== childOperationId ||
          record.requestHash !== params.requestHash || record.kind !== params.kind ||
          record.groupOperationId !== params.groupOperationId)
        throw failure("REQUEST_CONFLICT", "operationId was used for different local task metadata");
      return this.public(record);
    }
    if (fs.readdirSync(this.dir).length >= 10000)
      throw failure("OPERATION_CAPACITY", "Local operation record capacity reached");
    fs.mkdirSync(path.dirname(this.file(key)), { mode: 0o700 });
    const record = { schemaVersion: 1, operationId: key, profileId: this.agent.identity.deviceId,
      deviceId, childOperationId, kind: params.kind, requestHash: params.requestHash,
      state: "registered", createdAt: Date.now() };
    if (params.groupOperationId) record.groupOperationId = operationId(params.groupOperationId);
    durableWrite(this.file(key), record);
    return this.public(record);
  }
  list({ limit = 20, deviceId } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw failure("INVALID_LIMIT", "Operation list limit must be between 1 and 100");
    if (deviceId) operationId(deviceId);
    const records = [];
    records.push(...this.groups.list(deviceId), ...this.workflows.list(deviceId));
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      try {
        const record = this.record(name);
        if (!deviceId || record.deviceId === deviceId) records.push(this.public(record));
      } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'operations.cjs',line:77}); records.push({ operationId: name, state: "unknown", errorCode: "OPERATION_CORRUPT" }); }
    }
    return { ok: true, operations: records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit) };
  }
  async get(key, params = {}) {
    if (this.workflows.exists(key)) return this.workflows.get(key);
    if (this.groups.exists(key)) return this.groups.get(key, params);
    const record = this.record(key);
    if (record.state === "not_started" || record.localCancelled)
      return { ...this.public(record), ok: true, errorCode: record.errorCode || null };
    try {
      const control = await this.control(this.agent, record.deviceId);
      const result = await control.request("get", { ...params, operationId: record.childOperationId });
      validateTaskPage(result, { ...params, operationId: record.childOperationId, deviceId: record.deviceId });
      record.state = result.state; record.observedAt = Date.now();
      durableWrite(this.file(key), record);
      return { ...result, ...this.public(record), ok: true, outputEncoding: result.outputEncoding };
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'operations.cjs',line:94});
      return { ...this.public(record), ok: false, state: error.code === "OPERATION_NOT_FOUND" ? "unknown" : "unavailable",
        lastKnownState: record.state, error: publicFailure(error) };
    }
  }
  async cancel(key, params) {
    if (this.workflows.exists(key)) return this.workflows.cancel(key, params);
    if (this.groups.exists(key)) return this.groups.cancel(key, params);
    const record = this.record(key), requestId = operationId(params.requestId);
    if (["registered", "not_started"].includes(record.state) && !record.dispatchStartedAt) {
      record.state = "cancelled"; record.localCancelled = true; record.observedAt = Date.now();
      durableWrite(this.file(key), record);
      return { ...this.public(record), ok: true };
    }
    if (!record.cancelRequestId) {
      record.cancelRequestId = requestId;
      durableWrite(this.file(key), record);
    }
    const control = await this.control(this.agent, record.deviceId);
    const result = await control.request("cancel", { operationId: record.childOperationId,
      requestId: record.cancelRequestId });
    return { ...result, operationId: key, childOperationId: record.childOperationId };
  }
  markDispatch(key) {
    const record = this.record(key);
    if (record.localCancelled) throw failure("OPERATION_CANCELLED", "Operation was cancelled before dispatch");
    if (!record.dispatchStartedAt) {
      record.dispatchStartedAt = Date.now(); record.state = "dispatching";
      durableWrite(this.file(key), record);
    }
    return this.public(record);
  }
  notStarted(key) {
    const record = this.record(key);
    if (record.state === "registered" && !record.dispatchStartedAt) {
      record.state = "not_started"; record.observedAt = Date.now();
      durableWrite(this.file(key), record);
    }
    return this.public(record);
  }

}
module.exports = { Operations };
