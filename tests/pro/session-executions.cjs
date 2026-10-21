"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { SessionExecutions } = require("../../src/pro/session-executions.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-permit-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionId = crypto.randomUUID(), owner = crypto.randomUUID(), deviceId = crypto.randomUUID(), requestId = crypto.randomUUID(), dir = path.join(root, sessionId);
  fs.mkdirSync(dir); for (const name of ["inbox", "requests", "responses", "commands"]) fs.mkdirSync(path.join(dir, name));
  const config = { sessionId, owner, deviceId, osBoot: "boot", executionBudgetVersion: 1 };
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  save("session.json", config); save("manifest.json", { state: "open" }); save("inbox/" + requestId + ".json", {});
  save("requests/" + requestId + ".json", { sessionId, owner, requestId, method: "send", createdAt: 1, requestHash: "a".repeat(64) });
  const manager = { dir: root, deviceId, identityAvailable: true, authorized: () => true, scheduler: { activeCount: () => 0 },
    ownerForSession: () => owner, lookup: () => ({ dir, config }) };
  return { manager, root, dir, config, sessionId, requestId, owner, save };
}
test("session permit is durable before execution and survives Manager recreation", t => {
  const f = fixture(t), service = new SessionExecutions(f.manager, { inspect: () => "unconfirmed" });
  const queued = service.snapshot().queued; assert.equal(queued.length, 1);
  assert.equal(service.start(queued[0]), true); assert.equal(service.snapshot().active, 1);
  const reopened = new SessionExecutions(f.manager, { inspect: () => "unconfirmed" });
  assert.equal(reopened.snapshot().active, 1); assert.equal(reopened.snapshot().queued.length, 0);
  assert.equal(reopened.start(queued[0]), false);
  f.save("manifest.json", { state: "lost" }); assert.equal(reopened.snapshot().active, 1);
});
test("only the original final result releases a session execution claim", t => {
  const f = fixture(t), service = new SessionExecutions(f.manager); service.start(service.snapshot().queued[0]);
  fs.mkdirSync(path.join(f.dir, "commands", f.requestId));
  f.save("commands/" + f.requestId + "/result.json", { sessionId: f.sessionId, requestId: f.requestId, owner: f.owner,
    state: "completed", exitCode: 0, finishedAt: Date.now() });
  assert.equal(service.snapshot().active, 0); assert.equal(service.snapshot().queued.length, 0);
});
