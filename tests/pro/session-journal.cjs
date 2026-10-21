"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { SessionJournal } = require("../../src/pro/session-journal.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-journal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { dir, deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    owner: crypto.randomUUID(), platform: "linux", osBoot: "boot-a" };
  return { options, journal: new SessionJournal(options) };
}
const command = sequence => ({ requestId: crypto.randomUUID(), sequence, spec: { command: "echo private-input" } });
test("session requests deduplicate before busy checks and cannot change input", t => {
  const { options, journal } = fixture(t), input = command(1);
  const first = journal.accept(options.owner, input);
  assert.deepEqual(journal.accept(options.owner, input), first);
  assert.throws(() => journal.accept(options.owner, { ...input, spec: { command: "different" } }), { code: "REQUEST_CONFLICT" });
  assert.throws(() => journal.accept(options.owner, command(2)), { code: "SESSION_UNAVAILABLE" });
  assert.throws(() => journal.get(crypto.randomUUID(), input.requestId), { code: "SESSION_NOT_FOUND" });
  assert.equal(JSON.stringify(first).includes("private-input"), false);
});
test("command claim is one-time and only completion permits the next sequence", t => {
  const { options, journal } = fixture(t), input = command(1);
  journal.accept(options.owner, input);
  assert.equal(journal.claim(options.owner, input.requestId).spec.command, input.spec.command);
  assert.throws(() => journal.claim(options.owner, input.requestId), { code: "SESSION_COMMAND_UNKNOWN" });
  journal.complete(options.owner, input.requestId, { exitCode: 0 });
  assert.equal(journal.get(options.owner, input.requestId).result.exitCode, 0);
  assert.equal(fs.existsSync(journal.file(input.requestId, "input.json")), false);
  assert.throws(() => journal.accept(options.owner, command(3)), { code: "SESSION_SEQUENCE_CONFLICT" });
  assert.equal(journal.accept(options.owner, command(2)).sequence, 2);
});
test("restart never claims an accepted or running command and boot change loses shell", t => {
  const { options, journal } = fixture(t), input = command(1);
  journal.accept(options.owner, input); journal.claim(options.owner, input.requestId);
  const reopened = new SessionJournal(options);
  assert.equal(reopened.get(options.owner, input.requestId).state, "unknown");
  assert.throws(() => reopened.claim(options.owner, input.requestId), { code: "SESSION_COMMAND_UNKNOWN" });
  assert.throws(() => reopened.accept(options.owner, command(2)), { code: "SESSION_UNAVAILABLE" });
  const rebooted = new SessionJournal({ ...options, osBoot: "boot-b" });
  assert.throws(() => rebooted.accept(options.owner, command(2)), { code: "SESSION_LOST" });
});
test("completed results remain queryable after restart without claiming shell survival", t => {
  const { options, journal } = fixture(t), input = command(1);
  journal.accept(options.owner, input); journal.claim(options.owner, input.requestId);
  journal.complete(options.owner, input.requestId, { exitCode: 7 });
  const reopened = new SessionJournal(options);
  assert.equal(reopened.get(options.owner, input.requestId).result.exitCode, 7);
  assert.equal(reopened.record.state, "unknown");
  assert.throws(() => reopened.accept(options.owner, command(2)), { code: "SESSION_UNAVAILABLE" });
});
test("changed private command input cannot be claimed and missing final result is unknown", t => {
  const { options, journal } = fixture(t), input = command(1);
  journal.accept(options.owner, input);
  fs.writeFileSync(journal.file(input.requestId, "input.json"), JSON.stringify({ spec: { command: "different" } }));
  assert.throws(() => journal.claim(options.owner, input.requestId), { code: "SESSION_CORRUPT" });
  assert.equal(fs.existsSync(journal.file(input.requestId, "execution.lock")), false);
  fs.writeFileSync(journal.file(input.requestId, "input.json"), JSON.stringify({ spec: input.spec }));
  journal.claim(options.owner, input.requestId); journal.complete(options.owner, input.requestId, { exitCode: 0 });
  fs.rmSync(journal.file(input.requestId, "result.json"));
  const result = journal.get(options.owner, input.requestId);
  assert.equal(result.state, "unknown"); assert.equal(result.completed, false);
});
