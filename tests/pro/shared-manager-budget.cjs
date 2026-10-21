"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto"), { EventEmitter } = require("node:events");
const { ExecutionScheduler } = require("../../src/pro/execution-scheduler.cjs"), { TaskManager } = require("../../src/pro/tasks.cjs"), { SessionManager } = require("../../src/pro/session-manager.cjs");
const { SessionJournal } = require("../../src/pro/session-journal.cjs"), { durableWrite } = require("../../src/pro/task-store.cjs");
test("real Managers share two slots and preserve a session permit across Manager recreation", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-shared-managers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const owner = crypto.randomUUID(), deviceId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  let taskStarts = 0;
  const child = () => Object.assign(new EventEmitter(), { unref() {} });
  const taskOptions = { dir: path.join(dir, "tasks"), deviceId, bootId: crypto.randomUUID(), authorized: id => id === owner,
    processIdentityProvider: () => ({ fixture: true }), spawn: () => { taskStarts++; return child(); } };
  const sessionOptions = { dir: path.join(dir, "sessions"), deviceId, authorized: id => id === owner,
    identity: () => ({ fixture: true }), runnerLive: () => true, osBoot: "boot", platform: "linux", spawn: child };
  const scheduler = new ExecutionScheduler(), tasks = new TaskManager({ ...taskOptions, scheduler }), sessions = new SessionManager({ ...sessionOptions, scheduler });
  sessions.create(owner, { sessionId });
  const sessionDir = sessions.directory(sessionId);
  new SessionJournal({ dir: sessionDir, deviceId, sessionId, owner, platform: "linux", osBoot: "boot" });
  durableWrite(path.join(sessionDir, "runner.json"), { sessionId, owner });
  const first = { operationId: crypto.randomUUID(), kind: "exec", spec: { command: "fixture first" } }, second = { operationId: crypto.randomUUID(), kind: "exec", spec: { command: "fixture second" } };
  tasks.submit(owner, first);
  sessions.request(owner, { sessionId, requestId: crypto.randomUUID(), sequence: 1, spec: { command: "fixture session" } });
  tasks.submit(owner, second);
  assert.equal(taskStarts, 1); assert.equal(scheduler.activeCount(), 2);
  const restarted = new ExecutionScheduler(), recoveredTasks = new TaskManager({ ...taskOptions, bootId: crypto.randomUUID(), scheduler: restarted });
  new SessionManager({ ...sessionOptions, scheduler: restarted });
  recoveredTasks.tick(); assert.equal(taskStarts, 1); assert.equal(restarted.activeCount(), 2);
  durableWrite(recoveredTasks.file(first.operationId, "result.json"), { operationId: first.operationId, owner, state: "completed", exitCode: 0, finishedAt: Date.now(),
    stdout: { bytes: 0, totalBytes: 0, truncated: false }, stderr: { bytes: 0, totalBytes: 0, truncated: false } });
  recoveredTasks.tick(); assert.equal(taskStarts, 2); assert.equal(restarted.activeCount(), 2);
  assert.equal(recoveredTasks.records.get(second.operationId).state, "starting");
});
