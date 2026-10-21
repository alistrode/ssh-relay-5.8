"use strict";
const { operationId } = require("./task-spec.cjs");
const { read } = require("./store.cjs");
const { jobCatalog } = require("./task-jobs.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
function dispatchFarControl(agent, owner, method, params) {
  operationId(owner);
  if (!read(agent.file("far/authorized-clients.json"), {})[owner])
    throw failure("AUTH_REVOKED", "Controller authorization is no longer valid");
  if (typeof method !== "string" || method.length > 64 || !params || typeof params !== "object" || Array.isArray(params))
    throw failure("CONTROL_INVALID_REQUEST", "Invalid authenticated control request");
  if (method === "hello") {
    if (params.protocol !== 1) throw failure("CONTROL_UNSUPPORTED_PROTOCOL", "Unsupported control protocol");
    return { protocol: 1, deviceId: agent.identity.deviceId,
      capabilities: { persistentExec: agent.taskManager?.identityAvailable === true, taskProtocol: 1,
        taskJobs: jobCatalog(), fileProtocol: agent.remoteFiles ? 1 : undefined, sessionProtocol: 1, sessionResume: agent.sessionManager?.identityAvailable === true,
        recovery: "verified-live-runner", maxFrameBytes: 1048576, maxConcurrent: 4,
        maxOutputBytesPerStream: 67108864, maxPageBytesPerStream: 65536 } };
  }
  if (method.startsWith("file.")) {
    if (!agent.remoteFiles) throw failure("CONTROL_UNAVAILABLE", "File transfer service is not ready");
    return agent.remoteFiles.handle(owner, method, params);
  }
  if (method.startsWith("session.")) {
    if (!agent.sessionManager) throw failure("CONTROL_UNAVAILABLE", "Session manager is not ready");
    return agent.sessionManager.handle(owner, method, params);
  }
  if (!agent.taskManager) throw failure("CONTROL_UNAVAILABLE", "Task manager is not ready");
  return agent.taskManager.handle(owner, method, params);
}
module.exports = { dispatchFarControl };
