"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { Operations } = require("../../src/pro/operations.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-workflows-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), other = crypto.randomUUID();
  const agent = { file: name => path.join(dir, name), identity: { deviceId: crypto.randomUUID() },
    registry: () => ({ [deviceId]: {}, [other]: {} }) };
  const operations = new Operations(agent, { control: async () => { throw Error("No remote dispatch during metadata queries"); } });
  return { operations, deviceId, other, plan: { operationId: crypto.randomUUID(), deviceId, kind: "workflow", workflow: "deploy", requestHash: "a".repeat(64), stages: ["upload", "replace"] } };
}
test("workflow claims survive service recreation and never grant execution twice", async t => {
  const f = fixture(t), r = f.operations.register(f.plan), requestId = crypto.randomUUID();
  assert.equal(f.operations.workflows.stage(r.operationId, { action: "claim", name: "upload", requestId }).granted, true);
  assert.equal(f.operations.workflows.stage(r.operationId, { action: "claim", name: "upload", requestId }).granted, false);
  const restored = new Operations(f.operations.agent);
  assert.equal(restored.workflows.stage(r.operationId, { action: "claim", name: "upload", requestId }).granted, false);
  assert.throws(() => restored.workflows.stage(r.operationId, { action: "claim", name: "replace", requestId: crypto.randomUUID() }), { code: "WORKFLOW_BLOCKED" });
  const query = await restored.get(r.operationId);
  assert.equal(query.stages[0].state, "dispatching"); assert.equal(query.completed, false);
});
test("workflow cancellation blocks subsequent stages and never changes a finished outcome", async t => {
  const f = fixture(t), r = f.operations.register(f.plan), requestId = crypto.randomUUID();
  f.operations.workflows.stage(r.operationId, { action: "claim", name: "upload", requestId });
  f.operations.workflows.stage(r.operationId, { action: "finish", name: "upload", requestId, state: "completed" });
  assert.throws(() => f.operations.workflows.stage(r.operationId, { action: "finish", name: "upload", requestId, state: "failed" }), { code: "REQUEST_CONFLICT" });
  await f.operations.cancel(r.operationId, { requestId: crypto.randomUUID() });
  assert.throws(() => f.operations.workflows.stage(r.operationId, { action: "claim", name: "replace", requestId: crypto.randomUUID() }), { code: "OPERATION_CANCELLED" });
});
test("workflow cannot bind a child belonging to another device", t => {
  const f = fixture(t), r = f.operations.register(f.plan), requestId = crypto.randomUUID(), child = crypto.randomUUID();
  f.operations.register({ operationId: child, childOperationId: crypto.randomUUID(), deviceId: f.other, kind: "exec", requestHash: "b".repeat(64) });
  f.operations.workflows.stage(r.operationId, { action: "claim", name: "upload", requestId });
  assert.throws(() => f.operations.workflows.stage(r.operationId, { action: "bind", name: "upload", requestId, childOperationId: child }), { code: "REQUEST_CONFLICT" });
});
