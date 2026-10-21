"use strict";
const crypto = require("node:crypto");
const { operationId, normalizeSpec } = require("./task-spec.cjs");
function normalizeSessionRequest(params, platform) {
  const sessionId = operationId(params.sessionId), requestId = operationId(params.requestId);
  const method = params.method || "send";
  if (!["send", "close"].includes(method)) throw Object.assign(Error("Unsupported session request method"), { code: "SESSION_INVALID" });
  const spec = method === "send" ? normalizeSpec(params.spec, platform) : null;
  const sequence = method === "send" ? params.sequence : null;
  if (spec && (spec.cwd !== null || spec.command.includes("\0") || !Number.isInteger(sequence) || sequence < 1 || sequence > 10000))
    throw Object.assign(Error("Session requires a bounded command sequence and explicit shell directory changes"), { code: "SESSION_INVALID" });
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ sessionId, method, sequence, spec })).digest("hex");
  return { sessionId, requestId, method, sequence, spec, requestHash };
}
module.exports = { normalizeSessionRequest };
