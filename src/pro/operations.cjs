"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { durableWrite, privateJSON } = require("./task-store.cjs");
const { agentControl } = require("./agent-control.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
class Operations {
  constructor(agent) { this.agent = agent; this.dir = folder(agent.file("operations")); }
  file(key) { return path.join(this.dir, operationId(key), "manifest.json"); }
  record(key) {
    const record = privateJSON(this.file(key), null);
    if (!record) throw failure("OPERATION_NOT_FOUND", "Unknown local operation");
    if (record.operationId !== key || record.profileId !== this.agent.identity.deviceId ||
        !/^[a-f0-9]{64}$/.test(record.requestHash))
      throw failure("OPERATION_CORRUPT", "Local operation record is invalid");
    operationId(record.deviceId); operationId(record.childOperationId);
    return record;
  }
  public(record) {
    return { operationId: record.operationId, deviceId: record.deviceId,
      childOperationId: record.childOperationId, state: record.state, kind: record.kind,
      createdAt: record.createdAt, observedAt: record.observedAt || null };
  }
  register(params) {
    const key = operationId(params.operationId), deviceId = operationId(params.deviceId);
    const childOperationId = operationId(params.childOperationId);
    if (params.kind !== "exec" || !/^[a-f0-9]{64}$/.test(params.requestHash))
      throw failure("INVALID_REQUEST", "Invalid local task metadata");
    if (!this.agent.registry()[deviceId]) throw failure("DEVICE_NOT_FOUND", "Unknown paired device");
    const existing = privateJSON(this.file(key), null);
    if (existing) {
      const record = this.record(key);
      if (record.deviceId !== deviceId || record.childOperationId !== childOperationId ||
          record.requestHash !== params.requestHash || record.kind !== params.kind)
        throw failure("REQUEST_CONFLICT", "operationId was used for different local task metadata");
      return this.public(record);
    }
    if (fs.readdirSync(this.dir).length >= 10000)
      throw failure("OPERATION_CAPACITY", "Local operation record capacity reached");
    fs.mkdirSync(path.dirname(this.file(key)), { mode: 0o700 });
    const record = { schemaVersion: 1, operationId: key, profileId: this.agent.identity.deviceId,
      deviceId, childOperationId, kind: params.kind, requestHash: params.requestHash,
      state: "registered", createdAt: Date.now() };
    durableWrite(this.file(key), record);
    return this.public(record);
  }
  list({ limit = 20, deviceId } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw failure("INVALID_LIMIT", "Operation list limit must be between 1 and 100");
    if (deviceId) operationId(deviceId);
    const records = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      try {
        const record = this.record(name);
        if (!deviceId || record.deviceId === deviceId) records.push(this.public(record));
      } catch { records.push({ operationId: name, state: "unknown", errorCode: "OPERATION_CORRUPT" }); }
    }
    return { ok: true, operations: records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit) };
  }
  async get(key, params = {}) {
    const record = this.record(key);
    try {
      const control = await agentControl(this.agent, record.deviceId);
      const result = await control.request("get", { ...params, operationId: record.childOperationId });
      record.state = result.state; record.observedAt = Date.now();
      durableWrite(this.file(key), record);
      return { ...result, ...this.public(record), ok: true, outputEncoding: result.outputEncoding };
    } catch (error) {
      return { ...this.public(record), ok: false, state: error.code === "OPERATION_NOT_FOUND" ? "unknown" : "unavailable",
        lastKnownState: record.state, error: { code: error.code || "CONTROL_UNAVAILABLE",
          message: error.code ? error.message : "Remote operation could not be queried",
          retryable: error.code !== "OPERATION_NOT_FOUND" && error.retryable !== false } };
    }
  }
  async cancel(key, params) {
    const record = this.record(key), requestId = operationId(params.requestId);
    if (!record.cancelRequestId) {
      record.cancelRequestId = requestId;
      durableWrite(this.file(key), record);
    }
    const control = await agentControl(this.agent, record.deviceId);
    const result = await control.request("cancel", { operationId: record.childOperationId,
      requestId: record.cancelRequestId });
    return { ...result, operationId: key, childOperationId: record.childOperationId };
  }
}
module.exports = { Operations };
