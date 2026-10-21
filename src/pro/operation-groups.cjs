"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
function childCancelId(parentRequestId, childId) {
  const value = crypto.createHash("sha256").update(parentRequestId + ":" + childId).digest().subarray(0, 16);
  value[6] = (value[6] & 15) | 80; value[8] = (value[8] & 63) | 128;
  const hex = value.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
class OperationGroups {
  constructor(operations) {
    this.operations = operations;
    this.agent = operations.agent;
    this.dir = folder(this.agent.file("operation-groups"));
  }
  file(key) { return path.join(this.dir, operationId(key) + ".json"); }
  exists(key) { return fs.existsSync(this.file(key)); }
  record(key) {
    const record = privateJSON(this.file(key), null);
    if (!record) throw failure("OPERATION_NOT_FOUND", "Unknown group operation");
    if (record.operationId !== key || record.profileId !== this.agent.identity.deviceId ||
        record.kind !== "exec-group" || !Array.isArray(record.children) ||
        record.children.length < 1 || record.children.length > 5)
      throw failure("OPERATION_CORRUPT", "Group operation metadata is invalid");
    try {
      operationId(record.operationId);
      if (!/^[a-f0-9]{64}$/.test(record.requestHash) || !Number.isFinite(record.createdAt)) throw Error();
      const ids = new Set([key]), devices = new Set();
      for (const child of record.children) {
        operationId(child.operationId); operationId(child.childOperationId); operationId(child.deviceId);
        if (child.kind !== "exec" || child.groupOperationId !== key ||
            !/^[a-f0-9]{64}$/.test(child.requestHash) ||
            ids.has(child.operationId) || ids.has(child.childOperationId) ||
            child.operationId === child.childOperationId || devices.has(child.deviceId) ||
            this.exists(child.operationId)) throw Error();
        ids.add(child.operationId); ids.add(child.childOperationId); devices.add(child.deviceId);
      }
    } catch { throw failure("OPERATION_CORRUPT", "Group operation metadata is invalid"); }
    return record;
  }
  public(record) {
    return { operationId: record.operationId, kind: record.kind, state: record.state,
      createdAt: record.createdAt, observedAt: record.observedAt || null,
      children: record.children.map(({ operationId, childOperationId, deviceId }) => ({ operationId, childOperationId, deviceId })) };
  }
  verifyChild(child, groupId) {
    const record = this.operations.record(child.operationId);
    if (record.groupOperationId !== groupId || record.deviceId !== child.deviceId ||
        record.childOperationId !== child.childOperationId || record.requestHash !== child.requestHash ||
        record.kind !== child.kind)
      throw failure("OPERATION_CORRUPT", "Child operation does not belong to this group plan");
  }
  register(params) {
    const key = operationId(params.operationId);
    if (this.operations.exists(key)) throw failure("REQUEST_CONFLICT", "Operation ID already belongs to a single target");
    if (!/^[a-f0-9]{64}$/.test(params.requestHash) || !Array.isArray(params.children) ||
        params.children.length < 1 || params.children.length > 5)
      throw failure("INVALID_REQUEST", "Group requires one to five fixed device children");
    const ids = new Set([key]), devices = new Set();
    const children = params.children.map(child => {
      const value = { operationId: operationId(child.operationId), childOperationId: operationId(child.childOperationId),
        deviceId: operationId(child.deviceId), kind: "exec", requestHash: child.requestHash, groupOperationId: key };
      if (ids.has(value.operationId) || ids.has(value.childOperationId) ||
          value.operationId === value.childOperationId || devices.has(value.deviceId) ||
          !/^[a-f0-9]{64}$/.test(value.requestHash))
        throw failure("INVALID_REQUEST", "Group child identities must be distinct and immutable");
      ids.add(value.operationId); ids.add(value.childOperationId); devices.add(value.deviceId);
      return value;
    });
    // Check every existing ID before saving a plan or creating any new child.
    for (const child of children) {
      if (!this.agent.registry()[child.deviceId]) throw failure("DEVICE_NOT_FOUND", "Unknown paired device");
      if (this.exists(child.operationId)) throw failure("REQUEST_CONFLICT", "Child ID belongs to a group");
      if (this.operations.exists(child.operationId)) {
        try { this.verifyChild(child, key); }
        catch { throw failure("REQUEST_CONFLICT", "Child ID belongs to different task metadata"); }
      }
    }
    let record;
    if (this.exists(key)) {
      record = this.record(key);
      if (record.requestHash !== params.requestHash || JSON.stringify(record.children) !== JSON.stringify(children))
        throw failure("REQUEST_CONFLICT", "Group operation ID was used for different target plans");
    } else {
      if (fs.readdirSync(this.dir).length >= 10000) throw failure("OPERATION_CAPACITY", "Group record capacity reached");
      record = { schemaVersion: 1, kind: "exec-group", operationId: key,
        profileId: this.agent.identity.deviceId, requestHash: params.requestHash, children,
        state: "registered", createdAt: Date.now() };
      durableWrite(this.file(key), record);
    }
    // This only creates immutable metadata. No child is dispatched here.
    for (const child of children) this.operations.register(child);
    return this.public(record);
  }
  list(deviceId) {
    const groups = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const record = this.record(name.slice(0, -5));
        if (!deviceId || record.children.some(child => child.deviceId === deviceId)) groups.push(this.public(record));
      } catch { groups.push({ operationId: name.slice(0, -5), kind: "exec-group", state: "unknown", errorCode: "OPERATION_CORRUPT" }); }
    }
    return groups;
  }
  async get(key, params = {}) {
    const record = this.record(key);
    if (params.stdoutOffset || params.stderrOffset)
      throw failure("INVALID_GROUP_CURSOR", "Paginate each child operationId using its own byte offsets");
    const results = await Promise.all(record.children.map(async child => {
      try { this.verifyChild(child, key); return await this.operations.get(child.operationId, params); }
      catch (error) { return { operationId: child.operationId, deviceId: child.deviceId,
        state: "unknown", errorCode: error.code || "OPERATION_QUERY_FAILED" }; }
    }));
    const knownFinal = new Set(["completed", "failed", "cancelled", "not_started"]);
    const complete = results.every(result => knownFinal.has(result.state));
    const state = results.every(result => result.state === "completed") ? "completed" :
      complete ? (results.every(result => result.state === "cancelled") ? "cancelled" : "failed") :
      results.some(result => ["unknown", "unavailable"].includes(result.state)) ? "unknown" : "running";
    record.state = state; record.observedAt = Date.now(); durableWrite(this.file(key), record);
    return { ...this.public(record), ok: true, completed: complete, results };
  }
  async cancel(key, params) {
    const record = this.record(key), requestId = operationId(params.requestId);
    const results = await Promise.all(record.children.map(async child => {
      try { this.verifyChild(child, key); return await this.operations.cancel(child.operationId,
        { requestId: childCancelId(requestId, child.operationId) }); }
      catch (error) { return { operationId: child.operationId, deviceId: child.deviceId,
        state: "unknown", cancelRequested: false, errorCode: error.code || "CANCEL_FAILED" }; }
    }));
    return { operationId: key, kind: record.kind, state: "cancel_requested", results };
  }
}
module.exports = { OperationGroups, childCancelId };
