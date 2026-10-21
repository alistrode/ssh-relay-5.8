import { AsyncLocalStorage } from "node:async_hooks";
const plans = new AsyncLocalStorage();
export function withOperationPlan(plan, run) { return plans.run(plan, run); }
export function plannedOperation(deviceId) { return plans.getStore()?.get(deviceId); }
export function hasOperationPlan() { return plans.getStore() !== undefined; }
