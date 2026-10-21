"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sessionCommand } = require("../../src/pro/session-shell.cjs");
const { SessionOutput } = require("../../src/pro/session-output.cjs");
test("local non-PTY sh keeps cwd and environment with distinct stdout and stderr boundaries", { skip: process.platform !== "linux" }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-session-shell-"));
  const child = cp.spawn("/bin/sh", ["-s"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  let parser;
  child.stdout.on("data", bytes => parser?.feed("stdout", bytes));
  child.stderr.on("data", bytes => parser?.feed("stderr", bytes));
  const send = command => new Promise((resolve, reject) => {
    const marker = "RELAY_" + crypto.randomUUID().replaceAll("-", ""), output = { stdout: [], stderr: [] };
    const timer = setTimeout(() => reject(Error("local shell boundary timeout")), 3000);
    parser = new SessionOutput({ marker, onData: (name, bytes) => output[name].push(Buffer.from(bytes)),
      onComplete: result => { clearTimeout(timer); resolve({ ...result,
        stdout: Buffer.concat(output.stdout).toString(), stderr: Buffer.concat(output.stderr).toString() }); } });
    child.stdin.write(sessionCommand("linux", marker, command));
  });
  const first = await send("mkdir child && cd child && export RELAY_TEST_VALUE='persisted'; printf '中文'; printf 'error-text' >&2");
  assert.equal(first.exitCode, 0); assert.equal(first.stdout, "中文"); assert.equal(first.stderr, "error-text");
  assert.equal(first.cwd, path.join(dir, "child"));
  const second = await send("printf '%s' \"$RELAY_TEST_VALUE\"; false");
  assert.equal(second.stdout, "persisted"); assert.equal(second.exitCode, 1); assert.equal(second.cwd, first.cwd);
  const third = await send("mkdir 'line\nname' && cd 'line\nname'; PWD='spoofed'; export NODE_OPTIONS='--require=/does-not-exist'; printf 'ok'");
  assert.equal(third.cwd, path.join(first.cwd, "line\nname")); assert.equal(third.stdout, "ok");
  child.stdin.end("exit\n");
});
test("shell command framing rejects invalid platform, marker and null input", () => {
  const marker = "RELAY_" + "a".repeat(32);
  assert.throws(() => sessionCommand("linux", "invalid", "true"));
  assert.throws(() => sessionCommand("other", marker, "true"));
  assert.throws(() => sessionCommand("linux", marker, "a\0b"));
  const windows = sessionCommand("windows", marker, "Write-Output 'hello'");
  assert.equal(windows.includes("Write-Output 'hello'"), false);
  assert.equal(windows.includes(":END"), true);
});
