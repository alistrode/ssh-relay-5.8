"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { processIdentity } = require("../../src/pro/task-process.cjs");
const { systemBootId } = require("../../src/pro/store.cjs");
test("independent session runner refuses an unverifiable PID namespace before shell creation", {
  skip: !!processIdentity(process.pid) || !["linux", "win32"].includes(process.platform)
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-runner-guard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ schemaVersion: 1,
    sessionId: crypto.randomUUID(), deviceId: crypto.randomUUID(), owner: crypto.randomUUID(),
    platform: process.platform === "win32" ? "windows" : "linux", osBoot: systemBootId() }), { mode: 0o600 });
  const result = cp.spawnSync(process.execPath, [path.resolve(__dirname, "../../src/pro/session-runner.cjs"), dir],
    { timeout: 10000, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "runner-error.json"), "utf8")).errorCode, "PROCESS_IDENTITY_UNAVAILABLE");
  assert.equal(fs.existsSync(path.join(dir, "engine.lock")), false);
  assert.equal(fs.existsSync(path.join(dir, "commands")), false);
});
