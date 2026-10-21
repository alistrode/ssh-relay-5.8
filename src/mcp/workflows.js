import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
const stageContext = new AsyncLocalStorage();
export function currentWorkflowStage() { return stageContext.getStore(); }
import { localAgentClient } from "./config.js";
// Each invocation owns a distinct parent. Interrupted parents are queried via
// operation status; a query never invokes this closure or retries a stage.
export async function workflow(target, type, input, names, execute) {
  if (!target.agentDeviceId) return execute(async (_name, run) => run());
  const agent = await localAgentClient(), operationId = crypto.randomUUID();
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await agent.registerOperation({ operationId, deviceId: target.agentDeviceId,
    kind: "workflow", workflow: type, requestHash, stages: names });
  async function stage(name, run) {
    const requestId = crypto.randomUUID();
    const claim = await agent.workflowStage(operationId, { action: "claim", name, requestId });
    if (!claim.granted) throw Object.assign(Error("Saved workflow stage cannot be replayed"), { operationId });
    let result;
    try { result = await stageContext.run({ agent, operationId, name, requestId, deviceId: target.agentDeviceId }, run); }
    catch (error) {
      await agent.workflowStage(operationId, { action: "finish", name, requestId,
        state: "unknown", errorCode: "WORKFLOW_STAGE_INTERRUPTED" }).catch(() => {});
      throw Object.assign(error, { operationId, workflowOperationId: operationId });
    }
    const state = result?.completed === false ? "unknown" : result?.success === false ? "failed" : "completed";
    await agent.workflowStage(operationId, { action: "finish", name, requestId, state });
    if (state !== "completed") throw Object.assign(Error("Workflow stage is incomplete; query the saved operation"),
      { operationId, workflowOperationId: operationId, state, completed: false, childOperationId: result?.operationId });
    return result;
  }
  try { return { ...await execute(stage), workflowOperationId: operationId }; }
  catch (error) { throw Object.assign(error, { workflowOperationId: operationId, operationId: error.operationId || operationId }); }
}
