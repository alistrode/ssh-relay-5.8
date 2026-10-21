import { connect } from "./transport.js";
import { localAgentClient } from "./config.js";
import { execSpec } from "./durable-exec.js";
import { prepareGroupPlan } from "./group-plan.js";
export function prepareGroupOperations(targets, command, options) {
  return prepareGroupPlan(targets, command, options, { connect, localAgentClient, execSpec });
}
