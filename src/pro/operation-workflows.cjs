"use strict";
const fs = require("node:fs"), path = require("node:path");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
function fail(code, message) { throw Object.assign(Error(message), { code }); }
// Metadata only: workflow bodies, credentials, commands and raw output stay out.
class OperationWorkflows {
  constructor(operations) { this.operations = operations; this.dir = folder(path.join(operations.dir, "workflows")); }
  file(id) { return path.join(this.dir, operationId(id) + ".json"); }
  exists(id) { return fs.existsSync(this.file(id)); }
  record(id) {
    const r = privateJSON(this.file(id), null);
    if (!r) fail("OPERATION_NOT_FOUND", "Unknown workflow");
    if (r.operationId !== id || r.profileId !== this.operations.agent.identity.deviceId || !Array.isArray(r.stages) ||
        r.stages.length > 256 || !/^[a-f0-9]{64}$/.test(r.requestHash)) fail("OPERATION_CORRUPT", "Invalid workflow record");
    operationId(r.deviceId); return r;
  }
  register(p) {
    const id = operationId(p.operationId), deviceId = operationId(p.deviceId);
    if (!["deploy", "backup", "backup-restore", "database"].includes(p.workflow) || !/^[a-f0-9]{64}$/.test(p.requestHash) ||
        !Array.isArray(p.stages) || p.stages.length < 1 || p.stages.length > 256 ||
        p.stages.some(s => typeof s !== "string" || !/^[a-z0-9_-]{1,64}$/.test(s)) || new Set(p.stages).size !== p.stages.length)
      fail("INVALID_REQUEST", "Invalid workflow plan");
    if (!this.operations.agent.registry()[deviceId]) fail("DEVICE_NOT_FOUND", "Unknown workflow target");
    if (this.operations.exists(id) || this.operations.groups.exists(id)) fail("REQUEST_CONFLICT", "Operation ID is already in use");
    if (this.exists(id)) {
      const r = this.record(id);
      if (r.deviceId !== deviceId || r.workflow !== p.workflow || r.requestHash !== p.requestHash ||
          JSON.stringify(r.stages.map(s => s.name)) !== JSON.stringify(p.stages)) fail("REQUEST_CONFLICT", "Workflow plan differs");
      return r;
    }
    if (fs.readdirSync(this.dir).length >= 10000) fail("OPERATION_CAPACITY", "Workflow record capacity reached");
    const r = { schemaVersion: 1, operationId: id, profileId: this.operations.agent.identity.deviceId, deviceId,
      kind: "workflow", workflow: p.workflow, requestHash: p.requestHash, createdAt: Date.now(), state: "registered",
      stages: p.stages.map(name => ({ name, state: "not_started" })) };
    durableWrite(this.file(id), r); return r;
  }
  stage(id, p) {
    const r = this.record(id), index = r.stages.findIndex(s => s.name === p.name);
    if (index < 0) fail("INVALID_REQUEST", "Unknown workflow stage");
    const s = r.stages[index], requestId = operationId(p.requestId);
    if (p.action === "claim") {
      if (r.cancelRequestId) fail("OPERATION_CANCELLED", "Workflow cancellation blocks further stages");
      if (s.requestId) {
        if (s.requestId !== requestId) fail("REQUEST_CONFLICT", "Stage already has an execution identity");
        return { ...s, granted: false };
      }
      if (r.stages.slice(0, index).some(v => v.state !== "completed")) fail("WORKFLOW_BLOCKED", "A previous stage is incomplete");
      Object.assign(s, { requestId, state: "dispatching", startedAt: Date.now() });
      if (p.childOperationId) {
        const child = this.operations.record(operationId(p.childOperationId));
        if (child.deviceId !== r.deviceId) fail("REQUEST_CONFLICT", "Workflow child target differs");
        s.childOperationId = child.operationId;
      }
      r.state = "running"; durableWrite(this.file(id), r);
      return { ...s, granted: true };
    }
    if (p.action === "bind") {
      if (r.cancelRequestId) fail("OPERATION_CANCELLED", "Workflow cancellation blocks new children");
      if (s.requestId !== requestId || s.state !== "dispatching") fail("REQUEST_CONFLICT", "Stage is not dispatching");
      const child = this.operations.record(operationId(p.childOperationId));
      if (child.deviceId !== r.deviceId || (s.childOperationId && s.childOperationId !== child.operationId))
        fail("REQUEST_CONFLICT", "Workflow child differs from saved plan");
      s.childOperationId = child.operationId; durableWrite(this.file(id), r); return s;
    }
    if (p.action !== "finish" || s.requestId !== requestId || !["completed", "failed", "unknown"].includes(p.state))
      fail("REQUEST_CONFLICT", "Stage completion differs from saved execution");
    if (["completed", "failed", "unknown"].includes(s.state)) {
      if (s.state !== p.state) fail("REQUEST_CONFLICT", "Stage outcome cannot be replaced");
      return s;
    }
    s.state = p.state; s.finishedAt = Date.now();
    if (p.errorCode && /^[A-Z_]{1,64}$/.test(p.errorCode)) s.errorCode = p.errorCode;
    r.state = r.cancelRequestId ? "cancel_requested" : p.state === "completed" ? (r.stages.every(v => v.state === "completed") ? "completed" : "running") : p.state;
    r.observedAt = Date.now(); durableWrite(this.file(id), r); return s;
  }
  async cancel(id, params) {
    const r = this.record(id), requestId = operationId(params.requestId);
    if (["completed", "failed", "cancelled"].includes(r.state)) return { ...r, ok: true };
    if (!r.cancelRequestId) {
      r.cancelRequestId = requestId; r.observedAt = Date.now();
      r.state = r.stages.every(s => s.state === "not_started") ? "cancelled" : "cancel_requested";
      durableWrite(this.file(id), r);
    }
    const results = [];
    for (const s of r.stages) if (s.childOperationId && !["completed", "failed"].includes(s.state)) {
      try { results.push(await this.operations.cancel(s.childOperationId, { requestId: r.cancelRequestId })); }
      catch { results.push({ operationId: s.childOperationId, state: "unknown" }); }
    }
    return { ...r, ok: true, children: results };
  }
  list(deviceId) {
    const out = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try { const r = this.record(name.slice(0, -5)); if (!deviceId || r.deviceId === deviceId) out.push(r); } catch {}
    }
    return out;
  }
  async get(id) {
    const r = this.record(id);
    // Queries observe existing children; they never advance or replay stages.
    const stages = await Promise.all(r.stages.map(async s => {
      if (!s.childOperationId) return s;
      try { return { ...s, child: await this.operations.get(s.childOperationId, { limitBytes: 1 }) }; }
      catch { return { ...s, child: { state: "unknown", errorCode: "OPERATION_QUERY_FAILED" } }; }
    }));
    return { ...r, stages, completed: r.state === "completed" };
  }
}
module.exports = { OperationWorkflows };
