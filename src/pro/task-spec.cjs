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
  const normalized = normalizeTask(kind, spec, platform);
  return crypto.createHash("sha256").update(JSON.stringify({ deviceId, kind, spec: normalized })).digest("hex");
}
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const result = Object.create(null);
    for (const name of Object.keys(value).sort())
      if (value[name] !== undefined) result[name] = canonical(value[name]);
    return result;
  }
  throw invalid("Job arguments must be finite JSON values");
}
function normalizeJobSpec(spec) {
  if (!spec || !["alerts", "backup", "database", "health", "schedule", "tail"].includes(spec.name) ||
      !/^[a-f0-9]{64}$/.test(spec.sourceHash) || !spec.args || typeof spec.args !== "object" || Array.isArray(spec.args))
    throw invalid("A controlled job name, source hash and argument object are required");
  const args = canonical(spec.args), timeoutMs = spec.timeoutMs ?? 30000;
  if (Buffer.byteLength(JSON.stringify(args)) > 256 * 1024 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000)
    throw invalid("Job arguments or timeout exceed the supported limit");
  return { name: spec.name, sourceHash: spec.sourceHash, args, timeoutMs };
}
function normalizeTask(kind, spec, platform) {
  if (kind === "exec") return normalizeSpec(spec, platform);
  if (kind === "job") return normalizeJobSpec(spec);
  throw invalid("Task kind is not supported");
}
module.exports = { operationId, normalizeSpec, normalizeJobSpec, normalizeTask, requestHash };
