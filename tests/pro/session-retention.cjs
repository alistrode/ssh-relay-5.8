"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { cleanupSessions } = require("../../src/pro/session-retention.cjs");
test("retention keeps live and unconfirmed shells and deletes only old proven-dead sessions", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-retention-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), owner = crypto.randomUUID(), ids = {};
  for (const state of ["alive", "unconfirmed", "exited"]) {
    const sessionId = crypto.randomUUID(), dir = path.join(root, sessionId); ids[state] = sessionId; fs.mkdirSync(dir);
    const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    save("session.json", { sessionId, deviceId, owner, osBoot: "boot" });
    save("manifest.json", { sessionId, owner, state: "lost", closedAt: Date.now() - 8 * 86400000 });
    for (const name of ["runner.json", "shell.json"]) save(name, { sessionId, owner, sessionDir: dir, osBoot: "boot", state });
  }
  const removed = cleanupSessions(root, deviceId, { limit: 10, inspect: record => record.state });
  assert.deepEqual(removed, [ids.exited]);
  assert.equal(fs.existsSync(path.join(root, ids.alive)), true); assert.equal(fs.existsSync(path.join(root, ids.unconfirmed)), true);
});
test("bounded retention rotates past unconfirmed records", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-retention-rotate-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deviceId = crypto.randomUUID(), owner = crypto.randomUUID(), ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort();
  for (const [index, sessionId] of ids.entries()) {
    const dir = path.join(root, sessionId); fs.mkdirSync(dir);
    const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    save("session.json", { sessionId, deviceId, owner, osBoot: "boot" });
    save("manifest.json", { sessionId, owner, state: "lost", closedAt: Date.now() - 8 * 86400000 });
    for (const name of ["runner.json", "shell.json"]) save(name, { sessionId, owner, sessionDir: dir, osBoot: "boot", state: index < 2 ? "unconfirmed" : "exited" });
  }
  let cursor;
  const options = () => ({ limit: 2, startAfter: cursor, onExamined: value => { cursor = value; }, inspect: record => record.state });
  assert.equal(cleanupSessions(root, deviceId, options()).length, 0);
  assert.deepEqual(cleanupSessions(root, deviceId, options()), [ids[2]]);
});
