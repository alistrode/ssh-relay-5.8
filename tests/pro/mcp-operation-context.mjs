import test from "node:test";
import assert from "node:assert/strict";
import { withOperationPlan, plannedOperation } from "../../src/mcp/operation-context.js";
test("concurrent group plans cannot borrow each other's child IDs", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = withOperationPlan(new Map([["device", { operationId: "a" }]]), async () => {
    await gate;
    assert.equal(plannedOperation("device").operationId, "a");
  });
  await withOperationPlan(new Map([["device", { operationId: "b" }]]), async () => {
    assert.equal(plannedOperation("device").operationId, "b");
    release(); await a;
    assert.equal(plannedOperation("device").operationId, "b");
  });
  assert.equal(plannedOperation("device"), undefined);
});
