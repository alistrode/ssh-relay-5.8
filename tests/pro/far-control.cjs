"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { dispatchFarControl } = require("../../src/pro/far-control.cjs");
test("Far dispatch binds the signed owner, rechecks authorization, and separates task/session services", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-far-control-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "far"));
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), deviceId = crypto.randomUUID(), calls = [];
  const file = path.join(dir, "far/authorized-clients.json"); fs.writeFileSync(file, JSON.stringify({ [owner]: {} }));
  const agent = { identity: { deviceId }, file: name => path.join(dir, name),
    taskManager: { identityAvailable: false, handle: (...args) => { calls.push(["task", ...args]); return "task-result"; } },
    sessionManager: { identityAvailable: false, handle: (...args) => { calls.push(["session", ...args]); return "session-result"; } } };
  assert.equal(dispatchFarControl(agent, owner, "session.create", { owner: other }), "session-result");
  assert.equal(calls[0][1], owner); assert.equal(calls[0][2], "session.create");
  assert.equal(dispatchFarControl(agent, owner, "get", {}), "task-result");
  const hello = dispatchFarControl(agent, owner, "hello", { protocol: 1 });
  assert.equal(hello.deviceId, deviceId); assert.equal(hello.capabilities.sessionResume, false);
  assert.equal(hello.capabilities.persistentExec, false);
  assert.throws(() => dispatchFarControl(agent, owner, "hello", { protocol: 2 }), { code: "CONTROL_UNSUPPORTED_PROTOCOL" });
  fs.writeFileSync(file, "{}");
  assert.throws(() => dispatchFarControl(agent, owner, "session.send", { owner }), { code: "AUTH_REVOKED" });
  assert.equal(calls.length, 2);
});
