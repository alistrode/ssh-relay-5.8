"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertPrivateState } = require("../../src/pro/private-state.cjs");
test("private-state check rejects shared directories, readable tokens and symlink endpoints",
  { skip: process.platform === "win32" }, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-private-state-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, "agent-runtime.json"), "{}", { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "identity.json"), "{}", { mode: 0o600 });
    assert.doesNotThrow(() => assertPrivateState(dir));
    fs.chmodSync(dir, 0o755);
    assert.throws(() => assertPrivateState(dir), { code: "LOCAL_STATE_PERMISSIONS" });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(path.join(dir, "agent-runtime.json"), 0o644);
    assert.throws(() => assertPrivateState(dir), { code: "LOCAL_STATE_PERMISSIONS" });
    fs.unlinkSync(path.join(dir, "agent-runtime.json"));
    fs.symlinkSync(path.join(dir, "identity.json"), path.join(dir, "agent-runtime.json"));
    assert.throws(() => assertPrivateState(dir), { code: "LOCAL_STATE_PERMISSIONS" });
  });
