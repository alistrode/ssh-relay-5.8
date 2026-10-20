"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
function invalid(message) {
  return Object.assign(Error(message), { code: "INVALID_TASK_SPEC" });
}
function operationId(value) {
  if (typeof value !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))
    throw invalid("A UUID operationId is required");
  return value;
}
function normalizeSpec(spec, platform = process.platform === "win32" ? "windows" : "linux") {
  if (!spec || typeof spec !== "object" || Array.isArray(spec) ||
      typeof spec.command !== "string" || !spec.command.length ||
      Buffer.byteLength(spec.command) > 256 * 1024)
    throw invalid("A bounded command string is required");
  if (!["windows", "linux"].includes(platform)) throw invalid("Unsupported task platform");
  const shell = spec.shell || (platform === "windows" ? "powershell" : "sh");
  if (shell !== (platform === "windows" ? "powershell" : "sh"))
    throw invalid("Task shell must match the verified platform");
  const timeoutMs = spec.timeoutMs ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000)
    throw invalid("Task timeout must be between 1 and 86400000 ms");
  const cwd = spec.cwd ?? null;
  const paths = platform === "windows" ? path.win32 : path.posix;
  if (cwd !== null && (typeof cwd !== "string" || !paths.isAbsolute(cwd) || cwd.includes("\0")))
    throw invalid("Task cwd must be an absolute remote path");
  return { command: spec.command, shell, cwd: cwd === null ? null : paths.normalize(cwd), timeoutMs };
}
function requestHash(deviceId, kind, spec, platform) {
  operationId(deviceId);
  if (kind !== "exec") throw invalid("Task kind is not supported");
  const normalized = normalizeSpec(spec, platform);
  return crypto.createHash("sha256").update(JSON.stringify({ deviceId, kind, spec: normalized })).digest("hex");
}
module.exports = { operationId, normalizeSpec, requestHash };
