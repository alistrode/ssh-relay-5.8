import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prepareGroupPlan } from "../../src/mcp/group-plan.js";
import { plannedOperation } from "../../src/mcp/operation-context.js";
const targets = () => ["a", "b"].map(name => ({ name, config: { agentDeviceId: crypto.randomUUID(),
  platform: "linux", capabilities: { persistentExec: true, taskProtocol: 1 } } }));
const options = { timeout: 1000, strategy: "sequential" };
function deps(list, agent, connect) {
  return { connect: connect || (async name => ({ config: list.find(t => t.name === name).config })),
    localAgentClient: async () => agent,
    execSpec: (config, command) => ({ command, shell: "sh", timeoutMs: 1000 }) };
}
test("complete saved plan precedes any dispatched callback and preserves IDs", async () => {
  const list = targets(), events = [], saved = [];
  const agent = { registerOperation: async input => { events.push("register"); saved.push(input); },
    operationNotStarted: async id => ({ operationId: id, state: "not_started" }) };
  const plan = await prepareGroupPlan(list, "echo ok", options, deps(list, agent));
  assert.equal(saved[0].children.length, 2);
  await plan.run(async () => {
    events.push("dispatch");
    for (const child of plan.children) assert.equal(plannedOperation(child.deviceId).childOperationId, child.childOperationId);
  });
  assert.deepEqual(events, ["register", "dispatch"]);
  assert.equal((await plan.finish()).every(child => child.state === "not_started"), true);
});
test("connection failure or changed identity cannot register or run a group", async () => {
  const list = targets(); let registered = 0;
  const agent = { registerOperation: async () => { registered++; } };
  await assert.rejects(prepareGroupPlan(list, "command", options, deps(list, agent, async () => { throw Error("offline"); })), /offline/);
  await assert.rejects(prepareGroupPlan(list, "command", options, deps(list, agent, async () => ({ config: { ...list[0].config, agentDeviceId: crypto.randomUUID() } }))), /identity/);
  assert.equal(registered, 0);
});
test("uncertain registration retains parent query ID and cannot expose dispatch callback", async () => {
  const list = targets();
  await assert.rejects(prepareGroupPlan(list, "command", options, deps(list, {
    registerOperation: async () => { throw Error("lost reply"); }
  })), error => /^[a-f0-9-]{36}$/.test(error.operationId) && error.state === "unknown");
});
test("legacy or mixed capability groups leave dispatch to original path", async () => {
  const list = targets(); list[1].config.capabilities.persistentExec = false;
  assert.equal(await prepareGroupPlan(list, "command", options, {}), null);
});
test("duplicate stable devices are rejected before connecting or saving", async () => {
  const list = targets(); list[1].config.agentDeviceId = list[0].config.agentDeviceId;
  await assert.rejects(prepareGroupPlan(list, "command", options, {}), /duplicate target/);
  await assert.rejects(prepareGroupPlan([], "command", options, {}), /one and five/);
});
