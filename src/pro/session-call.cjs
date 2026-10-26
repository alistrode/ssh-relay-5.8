"use strict";
const { normalizeSessionRequest } = require("./session-spec.cjs");
const { executeTask } = require("./task-call.cjs");
function invalid() { return Object.assign(Error("Remote session command response is invalid"), { code: "CONTROL_RESULT_INVALID" }); }
async function executeSessionCommand(control, agent, { id, deviceId, remoteSessionId, requestId, sequence, spec, platform }, polling = {}) {
  const request = normalizeSessionRequest({ sessionId: remoteSessionId, requestId, sequence, spec }, platform);
  const unknown = error => ({ session: id, requestId, sequence, persistent: true, success: false,
    completed: false, state: "unknown", stdout: "", stderr: "", errorCode: error.code || "CONTROL_UNAVAILABLE" });
  try { await agent.registerSessionRequest(id, { requestId, sequence, requestHash: request.requestHash, kind: "send" }); }
  catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-call.cjs',line:10}); return unknown(error); }
  let cwd;
  function translate(value, offsets) {
    if (value?.error) throw Object.assign(Error("Session query failed"), { code: value.error.code || "CONTROL_UNAVAILABLE" });
    if (!value || value.sessionId !== remoteSessionId || value.deviceId !== deviceId || value.requestId !== requestId) throw invalid();
    cwd = value.result?.cwd ?? cwd;
    if (value.stdout || value.stderr) return { ...value, operationId: requestId,
      result: value.result ? { ...value.result, stdout: value.result.output?.stdout, stderr: value.result.output?.stderr } : undefined };
    if ((offsets.stdoutOffset || 0) !== 0 || (offsets.stderrOffset || 0) !== 0 || value.completed) throw invalid();
    if (!["submitted", "pending", "unknown", "lost"].includes(value.state)) throw invalid();
    return { operationId: requestId, deviceId, state: ["unknown", "lost"].includes(value.state) ? "unknown" : "accepted",
      errorCode: value.state === "lost" ? "SESSION_LOST" : value.errorCode,
      outputEncoding: "base64", stdout: { data: "", nextOffset: 0, storedBytes: 0 }, stderr: { data: "", nextOffset: 0, storedBytes: 0 } };
  }
  const bridge = { request: async (method, params) => {
    if (method === "submit") {
      const accepted = await control.request("session.send", { sessionId: remoteSessionId, requestId, sequence, spec: request.spec });
      if (!accepted || accepted.sessionId !== remoteSessionId || accepted.requestId !== requestId || accepted.deviceId !== deviceId) throw invalid();
    }
    return translate(await agent.session(id, { requestId, stdoutOffset: params.stdoutOffset || 0,
      stderrOffset: params.stderrOffset || 0, limitBytes: 65536 }), params);
  } };
  const result = await executeTask(bridge, { operationId: requestId }, { ...polling, parentOperationId: requestId,
    deviceId, timeout: request.spec.timeoutMs });
  const { operationId, childOperationId, ...value } = result;
  if (value.error) value.error = value.errorCode === "OUTPUT_PAGINATION_REQUIRED"
    ? "Query this session and requestId using the returned byte offsets"
    : "Query this session and requestId before sending another command";
  return { ...value, session: id, requestId, sequence, cwd };
}
module.exports = { executeSessionCommand };
