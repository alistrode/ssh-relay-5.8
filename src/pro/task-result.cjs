"use strict";
function invalid() {
  return Object.assign(Error("Remote task result or output cursor is invalid"),
    { code: "CONTROL_RESULT_INVALID", retryable: false });
}
function validateTaskPage(value, { operationId, deviceId, stdoutOffset = 0, stderrOffset = 0, limitBytes = 65536 }) {
  if (![stdoutOffset, stderrOffset].every(offset => Number.isSafeInteger(offset) && offset >= 0) ||
      !Number.isInteger(limitBytes) || limitBytes < 1 || limitBytes > 65536) throw invalid();
  if (!value || value.operationId !== operationId || value.deviceId !== deviceId ||
      !["accepted", "starting", "running", "completed", "failed", "cancelled", "unknown"].includes(value.state) ||
      value.outputEncoding !== "base64") throw invalid();
  for (const [name, offset] of [["stdout", stdoutOffset], ["stderr", stderrOffset]]) {
    const page = value[name];
    if (!page || typeof page.data !== "string" || page.data.length > Math.ceil(limitBytes / 3) * 4 ||
        !Number.isSafeInteger(page.nextOffset) || !Number.isSafeInteger(page.storedBytes) ||
        page.storedBytes < 0 || page.storedBytes > 67108864) throw invalid();
    const bytes = Buffer.from(page.data, "base64");
    if (bytes.length > limitBytes || bytes.toString("base64") !== page.data ||
        page.nextOffset !== offset + bytes.length || page.nextOffset > page.storedBytes) throw invalid();
  }
  if (["completed", "failed", "cancelled"].includes(value.state) && !value.result) throw invalid();
  if (value.result && (value.result.exitCode !== null && !Number.isInteger(value.result.exitCode))) throw invalid();
  if (value.state === "completed" && value.result.exitCode !== 0) throw invalid();
  return value;
}
function publicFailure(failure) {
  const known = /^(CONTROL|TASK|OPERATION|AUTH|REQUEST|INVALID|PROCESS|RUNNER|EXEC|JOB|SESSION|AGENT|DEVICE|STALE|ACCOUNT|WAITING|LOCAL)_/.test(failure.code || "");
  return { code: known ? failure.code : "CONTROL_STORAGE_FAILED",
    message: known ? failure.message : "Control operation could not access its private state",
    retryable: failure.retryable === true };
}
module.exports = { validateTaskPage, publicFailure };
