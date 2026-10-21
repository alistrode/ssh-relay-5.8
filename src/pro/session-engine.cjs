"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { SessionJournal } = require("./session-journal.cjs");
const { SessionLog } = require("./session-log.cjs");
const { SessionOutput } = require("./session-output.cjs");
const { sessionCommand } = require("./session-shell.cjs");
const { processIdentity } = require("./task-process.cjs");
const { folder } = require("./store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
// Internal single-writer engine. Independent process hosting/RPC is not enabled.
class SessionEngine {
  constructor(options, { spawn = cp.spawn, identity = processIdentity, signal } = {}) {
    if (!identity(process.pid)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Session process identity cannot be verified");
    this.identity = identity; this.owner = options.owner; this.platform = options.platform;
    this.dir = folder(path.resolve(options.dir)); this.active = null; this.closed = false;
    // Never take over an old engine lock or recreate an uncertain shell.
    try { fs.mkdirSync(path.join(this.dir, "engine.lock"), { mode: 0o700 }); }
    catch { throw failure("SESSION_ENGINE_EXISTS", "Session engine already exists or its previous state is uncertain"); }
    this.journal = new SessionJournal(options);
    if (this.journal.record.state !== "open") throw failure("SESSION_LOST", "Original session shell cannot be recreated");
    this.signal = signal || (child => {
      if (this.platform === "windows") {
        const killer = cp.spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => {});
      } else process.kill(-child.pid, "SIGKILL");
    });
    const windows = this.platform === "windows";
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    this.child = spawn(windows ? "powershell.exe" : "/bin/sh",
      windows ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-Command", "-"] : ["-s"],
      { cwd: options.cwd, env, detached: !windows, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("error", () => this.fail("SESSION_SPAWN_FAILED"));
    this.child.on("close", () => this.fail("SESSION_SHELL_EXITED"));
    this.child.stdin.on("error", () => this.fail("SESSION_INPUT_FAILED"));
    for (const name of ["stdout", "stderr"]) this.child[name].on("data", bytes => {
      if (!this.active || this.closed) return;
      try { this.active.parser.feed(name, bytes); }
      catch (error) { this.fail(error.code === "SESSION_OUTPUT_STORAGE_FAILED" ? error.code : "SESSION_OUTPUT_INVALID"); }
    });
    this.childIdentity = this.identity(this.child.pid);
    if (!this.childIdentity) { this.fail("PROCESS_IDENTITY_UNAVAILABLE"); throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Session shell identity cannot be verified"); }
    if (windows) this.child.stdin.write("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n");
  }
  matchesChild() {
    if (!this.childIdentity || this.child.exitCode !== null || this.child.signalCode !== null) return false;
    const current = this.identity(this.child.pid);
    return current && current.osBoot === this.childIdentity.osBoot && current.startToken === this.childIdentity.startToken;
  }
  fail(code) {
    if (this.closed) return;
    this.closed = true;
    const active = this.active; this.active = null;
    if (active) {
      clearTimeout(active.timer);
      try { active.log.finish(); } catch {}
    }
    try { this.journal.lose(this.owner, code); } catch {}
    try { this.child.stdin.destroy(); } catch {}
    try { if (this.matchesChild()) this.signal(this.child); } catch {}
    if (active) active.resolve({ sessionId: this.journal.sessionId, requestId: active.requestId,
      state: "unknown", completed: false, errorCode: code });
  }
  send(owner, params) {
    if (owner !== this.owner) throw failure("SESSION_NOT_FOUND", "Unknown session");
    if (this.closed) throw failure("SESSION_LOST", "Original session shell is unavailable");
    if (params.spec?.cwd != null) throw failure("SESSION_INVALID", "Change a session directory using an explicit shell command");
    const accepted = this.journal.accept(owner, params);
    if (accepted.state !== "accepted" || this.active) return Promise.resolve(this.journal.get(owner, params.requestId));
    if (!this.matchesChild()) { this.fail("PROCESS_IDENTITY_UNCONFIRMED"); return Promise.resolve({ ...accepted, state: "unknown", completed: false }); }
    let log, input;
    try {
      input = this.journal.claim(owner, params.requestId);
      log = new SessionLog(this.journal.directory(params.requestId));
    } catch (error) { this.fail(error.code === "SESSION_OUTPUT_STORAGE_FAILED" ? error.code : "SESSION_COMMAND_UNKNOWN"); return Promise.resolve({ ...accepted, state: "unknown", completed: false }); }
    return new Promise(resolve => {
      const marker = "RELAY_" + crypto.randomUUID().replaceAll("-", "");
      const active = { requestId: params.requestId, log, resolve, timer: null, parser: null };
      this.active = active;
      active.parser = new SessionOutput({ marker, onData: (name, bytes) => log.append(name, bytes),
        onComplete: result => {
          try {
            const stored = log.finish();
            // Logs must be fsynced before the final command result is written.
            const output = { stdout: { totalBytes: result.output.stdout.totalBytes, bytes: stored.stdout.bytes,
              truncated: result.output.stdout.truncated },
              stderr: { totalBytes: result.output.stderr.totalBytes, bytes: stored.stderr.bytes, truncated: result.output.stderr.truncated } };
            this.journal.complete(owner, params.requestId, { exitCode: result.exitCode, cwd: result.cwd, output });
            const final = this.journal.get(owner, params.requestId);
            clearTimeout(active.timer); this.active = null;
            resolve(final);
          } catch { this.fail("SESSION_OUTPUT_STORAGE_FAILED"); }
        } });
      active.timer = setTimeout(() => this.fail("SESSION_COMMAND_TIMEOUT"), input.spec.timeoutMs);
      try { this.child.stdin.write(sessionCommand(this.platform, marker, input.spec.command)); }
      catch { this.fail("SESSION_INPUT_FAILED"); }
    });
  }
  close(owner) {
    if (owner !== this.owner) throw failure("SESSION_NOT_FOUND", "Unknown session");
    this.fail("SESSION_CLOSED");
    return { sessionId: this.journal.sessionId, state: "lost" };
  }
}
module.exports = { SessionEngine };
