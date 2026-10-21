import crypto from "node:crypto";
import { createRequire } from "node:module";
import { withOperationPlan } from "./operation-context.js";
const require = createRequire(import.meta.url);
const { requestHash } = require("../pro/task-spec.cjs");
// Resolve and save the complete plan before allowing the first side effect.
export async function prepareGroupPlan(targets, command, options, { connect, localAgentClient, execSpec }) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 5)
    throw Error("Group execution requires between one and five targets");
  const deviceIds = targets.map(target => target.config?.agentDeviceId).filter(Boolean);
  if (new Set(deviceIds).size !== deviceIds.length) throw Error("Group contains duplicate target devices");
  if (targets.some(target => !target.config?.agentDeviceId ||
      !target.config.capabilities?.persistentExec || target.config.capabilities?.taskProtocol !== 1)) return null;
  const connections = await Promise.all(targets.map(target => connect(target.name)));
  const operationId = crypto.randomUUID(), plan = new Map();
  const children = connections.map((conn, index) => {
    const target = targets[index], config = conn.config;
    if (config.agentDeviceId !== target.config.agentDeviceId || !config.capabilities?.persistentExec ||
        config.capabilities?.taskProtocol !== 1) throw Error("Group target identity or task capability changed");
    const child = { operationId: crypto.randomUUID(), childOperationId: crypto.randomUUID(),
      deviceId: config.agentDeviceId, requestHash: requestHash(config.agentDeviceId, "exec",
        execSpec(config, command, { cwd: options.cwd || target.config.defaultDir, timeout: options.timeout }), config.platform) };
    plan.set(child.deviceId, { ...child, groupOperationId: operationId });
    return child;
  });
  const hash = crypto.createHash("sha256").update(JSON.stringify({ children, strategy: options.strategy,
    stopOnError: options.stopOnError, delay: options.delay })).digest("hex");
  const agent = await localAgentClient();
  try { await agent.registerOperation({ kind: "exec-group", operationId, requestHash: hash, children }); }
  catch (error) { throw Object.assign(error, { operationId, state: "unknown" }); }
  return { operationId, children,
    run: fn => withOperationPlan(plan, fn),
    async finish() {
      return Promise.all(children.map(child => agent.operationNotStarted(child.operationId)
        .catch(() => ({ ...child, state: "unknown" }))));
    } };
}
