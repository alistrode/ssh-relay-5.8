import crypto from "node:crypto";
import { createRequire } from "node:module";
import { connect, run, psQuote } from "./transport.js";
import { localAgentClient } from "./config.js";
import { shellQuote } from "./shell-quote.js";
const { openControl } = createRequire(import.meta.url)("../pro/agent-control.cjs");
const { normalizeSpec, requestHash } = createRequire(import.meta.url)("../pro/task-spec.cjs");
const controls = new WeakMap();
const CAPTURE = 2 * 1024 * 1024;
const FINAL = new Set(["completed", "failed", "cancelled", "unknown"]);
export async function durableExec(name, command, { cwd, timeout }) {
  const conn = await connect(name), config = conn.config;
  if (!config.agentDeviceId || !config.capabilities.persistentExec || config.capabilities.taskProtocol !== 1)
    return run(name, command, { cwd, timeout });
  let control = controls.get(conn);
  if (!control || control.channel.closed()) {
    control = await openControl(conn.client, config.agentDeviceId);
    controls.set(conn, control);
  }
  if (!control.capabilities.persistentExec) throw Error("Verified target does not support persistent exec");
  let script = command;
  if (cwd) script = config.platform === "windows"
    ? "Set-Location -LiteralPath " + psQuote(cwd) + ";\n" + script
    : "cd -- " + shellQuote(cwd) + " && " + script;
  const spec = normalizeSpec({ command: script, timeoutMs: timeout }, config.platform);
  const operationId = crypto.randomUUID(), childOperationId = crypto.randomUUID();
  const hash = requestHash(config.agentDeviceId, "exec", spec, config.platform);
  const agent = await localAgentClient();
  await agent.registerOperation({ operationId, childOperationId, deviceId: config.agentDeviceId,
    kind: "exec", requestHash: hash });
  const chunks = { stdout: [], stderr: [] }, offsets = { stdout: 0, stderr: 0 };
  let size = 0;
  const partial = () => ({ operationId, childOperationId, persistent: true,
    stdout: Buffer.concat(chunks.stdout).toString("utf8"),
    stderr: Buffer.concat(chunks.stderr).toString("utf8"),
    stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr });
  try {
    let page = await control.request("submit", { operationId: childOperationId, kind: "exec", requestHash: hash, spec });
    const deadline = Date.now() + timeout + 1000;
    while (true) {
      let pagination = false;
      for (const name of ["stdout", "stderr"]) {
        const bytes = Buffer.from(page[name].data, "base64");
        const take = Math.min(bytes.length, CAPTURE - size);
        if (take) chunks[name].push(bytes.subarray(0, take));
        offsets[name] += take; size += take;
        if (take < bytes.length) pagination = true;
      }
      if (pagination) return { ...partial(), success: false, state: page.state, completed: FINAL.has(page.state),
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
      if (Date.now() >= deadline) return { ...partial(), success: false, completed: false, state: page.state,
        errorCode: "OPERATION_PENDING", error: "Operation is still pending; query this operationId before any retry" };
      if (drained) await new Promise(resolve => setTimeout(resolve, 250));
      page = await control.request("get", { operationId: childOperationId,
        stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr, limitBytes: 65536 });
    }
  } catch (error) {
    return { ...partial(), success: false, completed: false, state: "unknown",
      errorCode: error.code || "CONTROL_UNAVAILABLE",
      error: "Operation outcome is unknown; query this operationId before any retry" };
  }
}
