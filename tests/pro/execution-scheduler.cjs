"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { ExecutionScheduler } = require("../../src/pro/execution-scheduler.cjs");
test("tasks and sessions share two slots and oldest queued request starts first", () => {
  const scheduler = new ExecutionScheduler(), calls = [];
  const task = { active: 0, queued: [{ key: "task", createdAt: 20 }] }, session = { active: 0, queued: [{ key: "session", createdAt: 10 }] };
  for (const [kind, state] of [["task", task], ["session", session]]) scheduler.register(kind, { snapshot: () => state,
    start: request => { calls.push(request.key); state.active++; state.queued = []; return true; } });
  scheduler.tick(); scheduler.tick(); assert.deepEqual(calls, ["session", "task"]); assert.equal(scheduler.activeCount(), 2);
});
test("uncertain active claims block new work until the provider proves release", () => {
  const scheduler = new ExecutionScheduler(); let active = 2, started = 0;
  scheduler.register("work", { snapshot: () => ({ active, queued: [{ key: "pending", createdAt: 1 }] }),
    start: () => { started++; active++; return true; } });
  scheduler.tick(); assert.equal(started, 0);
  active = 1; scheduler.tick(); assert.equal(started, 1);
});
test("failed and recursive starts cannot overrun the shared budget", () => {
  const scheduler = new ExecutionScheduler({ limit: 1 }); let active = 0; const calls = [];
  scheduler.register("work", { snapshot: () => ({ active, queued: [{ key: "bad", createdAt: 1 }, { key: "good", createdAt: 2 }] }),
    start: request => { calls.push(request.key); scheduler.tick(); if (request.key === "bad") return false; active++; return true; } });
  scheduler.tick(); assert.deepEqual(calls, ["bad", "good"]); assert.equal(active, 1);
});
