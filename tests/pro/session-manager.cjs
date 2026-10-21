"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { SessionManager } = require("../../src/pro/session-manager.cjs");
const { SessionJournal } = require("../../src/pro/session-journal.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-manager-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let spawns = 0;
  const options = { dir, deviceId: crypto.randomUUID(), authorized: () => true, identity: () => ({}), osBoot: "boot", platform: "linux", runnerLive: () => true,
    spawn: () => { spawns++; const child = new EventEmitter(); child.unref = () => {}; return child; } };
  const owner = crypto.randomUUID(), sessionId = crypto.randomUUID(), manager = new SessionManager(options);
  return { dir, options, owner, sessionId, manager, spawns: () => spawns };
}
test("session creation saves once and restart never respawns the old shell", t => {
  const f = fixture(t);
  assert.equal(f.manager.create(f.owner, { sessionId: f.sessionId }).state, "starting");
  f.manager.create(f.owner, { sessionId: f.sessionId });
  new SessionManager(f.options).create(f.owner, { sessionId: f.sessionId });
  assert.equal(f.spawns(), 1);
  assert.throws(() => f.manager.create(f.owner, { sessionId: f.sessionId, cwd: "/different" }), { code: "REQUEST_CONFLICT" });
  assert.throws(() => f.manager.status(crypto.randomUUID(), f.sessionId), { code: "SESSION_NOT_FOUND" });
});
test("request duplicates only query and never republish a lost inbox entry", t => {
  const f = fixture(t); f.manager.create(f.owner, { sessionId: f.sessionId });
  const dir = path.join(f.dir, f.sessionId), config = JSON.parse(fs.readFileSync(path.join(dir, "session.json")));
  new SessionJournal({ ...config, dir });
  fs.writeFileSync(path.join(dir, "runner.json"), JSON.stringify({ owner: f.owner, sessionId: f.sessionId }));
  const input = { sessionId: f.sessionId, requestId: crypto.randomUUID(), sequence: 1, spec: { command: "echo private-value" } };
  assert.equal(f.manager.request(f.owner, input).state, "submitted");
  const inbox = path.join(dir, "inbox", input.requestId + ".json"); fs.rmSync(inbox);
  assert.equal(f.manager.request(f.owner, input).state, "unknown");
  assert.equal(fs.existsSync(inbox), false);
  assert.throws(() => f.manager.request(f.owner, { ...input, spec: { command: "changed" } }), { code: "REQUEST_CONFLICT" });
  const record = fs.readFileSync(path.join(dir, "requests", input.requestId + ".json"), "utf8");
  assert.equal(record.includes("private-value"), false);
});
test("unprovable process identity refuses a new session without spawn", t => {
  const f = fixture(t), manager = new SessionManager({ ...f.options, identity: () => null });
  assert.throws(() => manager.create(f.owner, { sessionId: f.sessionId }), { code: "PROCESS_IDENTITY_UNAVAILABLE" });
  assert.equal(f.spawns(), 0);
  assert.equal(fs.existsSync(path.join(f.dir, f.sessionId)), false);
});
test("revocation remains idempotent after authorization removal and scopes the original owner", t => {
  const f = fixture(t); f.manager.create(f.owner, { sessionId: f.sessionId });
  const other = crypto.randomUUID(), otherId = crypto.randomUUID(); f.manager.create(other, { sessionId: otherId });
  f.manager.authorized = () => false;
  const first = f.manager.revoke(f.owner), second = f.manager.revoke(f.owner);
  assert.equal(first.length, 1); assert.equal(first[0].state, "close_requested");
  assert.equal(second[0].requestId, first[0].requestId);
  assert.equal(fs.existsSync(path.join(f.dir, otherId, "revoke.json")), false);
  assert.throws(() => f.manager.status(f.owner, f.sessionId), { code: "AUTH_REVOKED" });
});
test("Agent restart reconciles removed authorization without spawning or trusting JSON owner", t => {
  const f = fixture(t); f.manager.handle(f.owner, "session.create", { sessionId: f.sessionId, owner: crypto.randomUUID() });
  const config = JSON.parse(fs.readFileSync(path.join(f.dir, f.sessionId, "session.json")));
  assert.equal(config.owner, f.owner);
  const restarted = new SessionManager({ ...f.options, authorized: () => false });
  assert.equal(fs.existsSync(path.join(f.dir, f.sessionId, "revoke.json")), true);
  assert.equal(f.spawns(), 1);
  assert.throws(() => restarted.handle(f.owner, "session.status", { sessionId: f.sessionId }), { code: "AUTH_REVOKED" });
});
