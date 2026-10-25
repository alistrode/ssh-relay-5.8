import crypto from "node:crypto";
import { createRequire } from "node:module";
import { connect, psQuote } from "./transport.js";
import { localAgentClient } from "./config.js";
import { shellQuote } from "./shell-quote.js";
import { currentWorkflowStage } from "./workflows.js";
import { plannedOperation, hasOperationPlan } from "./operation-context.js";
const require = createRequire(import.meta.url);
const { openControl } = require("../pro/agent-control.cjs");
const { normalizeSpec, normalizeJobSpec, requestHash } = require("../pro/task-spec.cjs");
const { executeTask } = require("../pro/task-call.cjs");
const controls = new WeakMap();
async function controlFor(conn) {
  let control = controls.get(conn);
  if (!control || control.channel.closed()) {
    control = await openControl(conn.client, conn.config.agentDeviceId);
    controls.set(conn, control);
  }
  if (!control.capabilities.persistentExec) throw Error("Verified target does not support persistent tasks");
  return control;
}
async function submitTask(conn, kind, spec, timeout) {
  const config = conn.config, control = await controlFor(conn);
  if (kind === "job" && control.capabilities.taskJobs?.[spec.name] !== spec.sourceHash)
    throw Object.assign(Error("Controlled job versions differ; use matching application packages"),
      { code: "JOB_VERSION_MISMATCH" });
  const plan = plannedOperation(config.agentDeviceId);
  if (hasOperationPlan() && !plan)
    throw Object.assign(Error("Target differs from the saved group plan"), { code: "REQUEST_CONFLICT" });
  const operationId = plan?.operationId || crypto.randomUUID();
  const childOperationId = plan?.childOperationId || crypto.randomUUID();
  const hash = requestHash(config.agentDeviceId, kind, spec, config.platform);
  if (plan && (kind !== "exec" || plan.requestHash !== hash))
    throw Object.assign(Error("Execution differs from the saved group plan"), { code: "REQUEST_CONFLICT", operationId });
  const agent = await localAgentClient();
  await agent.registerOperation({ operationId, childOperationId, deviceId: config.agentDeviceId, kind, requestHash: hash,
    ...(plan ? { groupOperationId: plan.groupOperationId } : {}) });
  const stage = currentWorkflowStage();
  if (stage) {
    if (stage.deviceId !== config.agentDeviceId) throw Object.assign(Error("Workflow target differs"), { code: "REQUEST_CONFLICT" });
    await stage.agent.workflowStage(stage.operationId, { action: "bind", name: stage.name,
      requestId: stage.requestId, childOperationId: operationId });
  }
  await agent.markOperationDispatch(operationId);
  const result = await executeTask(control,
    { operationId: childOperationId, kind, requestHash: hash, spec },
    { parentOperationId: operationId, deviceId: config.agentDeviceId, timeout });
  if (result.completed) {
    // Refresh only metadata and one byte per stream; logs remain remotely paged.
    await agent.operation(operationId, { stdoutOffset: result.stdoutOffset,
      stderrOffset: result.stderrOffset, limitBytes: 1 }).catch(() => {});
  }
  return result;
}
export async function durableExec(name, command, { cwd, timeout }) {
  const conn = await connect(name), config = conn.config;
  if (hasOperationPlan() && !plannedOperation(config.agentDeviceId))
    throw Object.assign(Error("Target differs from the saved group plan"), { code: "REQUEST_CONFLICT" });
  if (plannedOperation(config.agentDeviceId) &&
      (!config.capabilities.persistentExec || config.capabilities.taskProtocol !== 55))
    throw Object.assign(Error("Saved group target no longer supports persistent tasks"), { code: "TASK_UNSUPPORTED" });
  if (!config.agentDeviceId || !config.capabilities.persistentExec || config.capabilities.taskProtocol !== 55)
    throw Object.assign(Error("5.5 persistent execution is required; older endpoints are refused"), { code: "RELEASE_MISMATCH" });
  return submitTask(conn, "exec", execSpec(config, command, { cwd, timeout }), timeout);
}
export function execSpec(config, command, { cwd, timeout }) {
  let script = command;
  if (cwd) script = config.platform === "windows"
    ? "Set-Location -LiteralPath " + psQuote(cwd) + ";\n" + script
    : "cd -- " + shellQuote(cwd) + " && " + script;
  return normalizeSpec({ command: script, timeoutMs: timeout }, config.platform);
}
export async function durableJob(server, name, args, timeout, sourceHash) {
  const conn = await connect(server);
  const result = await submitTask(conn, "job",
    normalizeJobSpec({ name, args, timeoutMs: timeout, sourceHash }), timeout);
  if (!result.success) return result;
  try {
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid job result");
    return { ...value, code: result.code, operationId: result.operationId,
      childOperationId: result.childOperationId, persistent: true, completed: result.completed, state: result.state };
  } catch {
    return { success: false, operationId: result.operationId, childOperationId: result.childOperationId,
      completed: result.completed, state: result.state, errorCode: "JOB_RESULT_INVALID",
      error: "Controlled job result needs inspection through the original operationId" };
  }
}

