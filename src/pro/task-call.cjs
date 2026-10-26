"use strict";
const { validateTaskPage } = require("./task-result.cjs");
const FINAL = new Set(["completed", "failed", "cancelled", "unknown"]);
async function executeTask(control, request, {
  parentOperationId, deviceId, timeout, captureBytes = 2 * 1024 * 1024,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const chunks = { stdout: [], stderr: [] }, offsets = { stdout: 0, stderr: 0 };
  let size = 0;
  const partial = () => ({ operationId: parentOperationId, childOperationId: request.operationId, persistent: true,
    stdout: Buffer.concat(chunks.stdout).toString("utf8"),
    stderr: Buffer.concat(chunks.stderr).toString("utf8"),
    stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr });
  try {
    let page = await control.request("submit", request);
    const deadline = now() + timeout + 1000;
    while (true) {
      validateTaskPage(page, { operationId: request.operationId, deviceId: deviceId,
        stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr });
      let pagination = false;
      for (const name of ["stdout", "stderr"]) {
        const bytes = Buffer.from(page[name].data, "base64");
        const take = Math.min(bytes.length, captureBytes - size);
        if (take) chunks[name].push(bytes.subarray(0, take));
        offsets[name] += take; size += take;
        if (take < bytes.length) pagination = true;
      }
      if (pagination) return { ...partial(), success: false, state: page.state, completed: !!page.result,
        code: page.result?.exitCode, errorCode: "OUTPUT_PAGINATION_REQUIRED",
        error: "Output exceeds the inline limit; query this operationId using the returned byte offsets" };
      const drained = offsets.stdout >= page.stdout.storedBytes && offsets.stderr >= page.stderr.storedBytes;
      if (FINAL.has(page.state) && drained) {
        return { ...partial(), state: page.state, completed: !!page.result,
          success: page.state === "completed" && page.result?.exitCode === 0,
          code: page.result?.exitCode, signal: page.result?.signal,
          truncated: !!(page.result?.stdout?.truncated || page.result?.stderr?.truncated),
          errorCode: page.errorCode || (page.state === "unknown" ? "OPERATION_UNKNOWN" : undefined) };
      }
      if (now() >= deadline) return { ...partial(), success: false, completed: false, state: page.state,
        errorCode: "OPERATION_PENDING", error: "Operation is still pending; query this operationId before any retry" };
      if (drained) await sleep(250);
      page = await control.request("get", { operationId: request.operationId,
        stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr, limitBytes: 65536 });
    }
  } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'task-call.cjs',line:45});
    return { ...partial(), success: false, completed: false, state: "unknown",
      errorCode: error.code || "CONTROL_UNAVAILABLE",
      error: "Operation outcome is unknown; query this operationId before any retry" };
  }
}
module.exports = { executeTask };

