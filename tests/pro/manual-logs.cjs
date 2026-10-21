"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { clearLogs } = require("../../src/pro/manual-logs.cjs");
test("manual clear truncates only fixed diagnostic files and preserves recovery data", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-manual-logs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ["agent-events.jsonl", "gui.jsonl.1", "session.json", "user.txt"]) fs.writeFileSync(path.join(dir, name), "keep");
  const fd = fs.openSync(path.join(dir, "agent-events.jsonl"), "a");
  try {
    assert.equal(clearLogs(dir).cleared, 2);
    assert.equal(fs.readFileSync(path.join(dir, "session.json"), "utf8"), "keep");
    assert.equal(fs.readFileSync(path.join(dir, "user.txt"), "utf8"), "keep");
    fs.writeSync(fd, "new");
    assert.equal(fs.readFileSync(path.join(dir, "agent-events.jsonl"), "utf8"), "new");
    fs.symlinkSync(path.join(dir, "user.txt"), path.join(dir, "guardian-events.jsonl"));
    assert.throws(() => clearLogs(dir));
    assert.equal(fs.readFileSync(path.join(dir, "user.txt"), "utf8"), "keep");
  } finally { fs.closeSync(fd); }
});
