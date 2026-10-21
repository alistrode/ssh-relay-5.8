"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SessionLog } = require("../../src/pro/session-log.cjs");
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-log-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test("private logs retain exact byte pages across reopen and truncate without stopping drain", t => {
  const dir = temp(t), log = new SessionLog(dir, { limitBytes: 7 });
  log.append("stdout", Buffer.from("中文abc")); log.append("stdout", Buffer.from("more"));
  log.append("stderr", Buffer.from("error"));
  const result = log.finish();
  assert.deepEqual(result.stdout, { bytes: 7, totalBytes: 13, truncated: true });
  const first = SessionLog.page(dir, "stdout", 0, 2), rest = SessionLog.page(dir, "stdout", first.nextOffset);
  assert.deepEqual(Buffer.concat([Buffer.from(first.data, "base64"), Buffer.from(rest.data, "base64")]), Buffer.from("中文a"));
  assert.equal(rest.nextOffset, 7);
  assert.throws(() => new SessionLog(dir), { code: "SESSION_OUTPUT_STORAGE_FAILED" });
  assert.equal(Buffer.from(SessionLog.page(dir, "stderr").data, "base64").toString(), "error");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "stdout.bin")).mode & 0o777, 0o600);
});
test("invalid cursors and closed writers cannot alter saved output", t => {
  const dir = temp(t), log = new SessionLog(dir); log.append("stdout", Buffer.from("x")); log.finish();
  assert.throws(() => SessionLog.page(dir, "stdout", 2), { code: "INVALID_SESSION_CURSOR" });
  assert.throws(() => SessionLog.page(dir, "stdout", 0, 65537), { code: "INVALID_SESSION_CURSOR" });
  assert.throws(() => SessionLog.page(dir, "../manifest"), { code: "INVALID_SESSION_CURSOR" });
  assert.throws(() => log.append("stdout", Buffer.from("changed")), { code: "SESSION_OUTPUT_STORAGE_FAILED" });
  assert.equal(fs.readFileSync(path.join(dir, "stdout.bin"), "utf8"), "x");
});
test("storage failure cannot produce a successful finish and errors omit private paths", t => {
  const dir = temp(t), log = new SessionLog(dir);
  fs.closeSync(log.streams.stdout.fd);
  assert.throws(() => log.append("stdout", Buffer.from("not-saved")), error =>
    error.code === "SESSION_OUTPUT_STORAGE_FAILED" && !error.message.includes(dir));
  assert.throws(() => log.finish(), { code: "SESSION_OUTPUT_STORAGE_FAILED" });
  fs.rmSync(path.join(dir, "stderr.bin"));
  assert.throws(() => SessionLog.page(dir, "stderr"), error =>
    error.code === "SESSION_OUTPUT_STORAGE_FAILED" && !error.message.includes(dir));
});
