"use strict";
const { TextDecoder } = require("node:util");
function failure(message) { return Object.assign(Error(message), { code: "SESSION_OUTPUT_INVALID" }); }
// Byte-oriented completion trailers for a future non-PTY session runner.
// Both pipes must acknowledge the boundary before a command can complete.
class SessionOutput {
  constructor({ marker, onData, onComplete, onExtra = () => {}, limitBytes = 64 * 1024 * 1024 }) {
    if (!/^RELAY_[a-f0-9]{32}$/.test(marker) || typeof onData !== "function" || typeof onComplete !== "function" ||
        !Number.isSafeInteger(limitBytes) || limitBytes < 0 || limitBytes > 64 * 1024 * 1024)
      throw failure("Invalid session output parser configuration");
    this.prefix = Buffer.from("\n" + marker + ":");
    this.marker = marker; this.onData = onData; this.onComplete = onComplete; this.onExtra = onExtra;
    this.limitBytes = limitBytes; this.done = false; this.failed = false; this.result = null;
    this.streams = Object.fromEntries(["stdout", "stderr"].map(name => [name,
      { pending: Buffer.alloc(0), ended: false, totalBytes: 0, storedBytes: 0, truncated: false }]));
  }
  output(name, data) {
    const stream = this.streams[name];
    stream.totalBytes += data.length;
    const keep = Math.min(data.length, Math.max(0, this.limitBytes - stream.storedBytes));
    if (keep) { this.onData(name, data.subarray(0, keep)); stream.storedBytes += keep; }
    stream.truncated = stream.totalBytes > stream.storedBytes;
  }
  feed(name, bytes) {
    if (this.failed) throw failure("Session output parser has already failed");
    try { return this.consume(name, bytes); }
    catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-output.cjs',line:27}); this.failed = true; throw error; }
  }
  consume(name, bytes) {
    const stream = this.streams[name];
    if (!stream || !Buffer.isBuffer(bytes)) throw failure("Session output must be named byte buffers");
    if (stream.ended) { if (bytes.length) this.onExtra(name, bytes); return; }
    stream.pending = Buffer.concat([stream.pending, bytes]);
    const index = stream.pending.indexOf(this.prefix);
    if (index < 0) {
      const emit = Math.max(0, stream.pending.length - this.prefix.length + 1);
      if (emit) { this.output(name, stream.pending.subarray(0, emit)); stream.pending = stream.pending.subarray(emit); }
      return;
    }
    if (index) { this.output(name, stream.pending.subarray(0, index)); stream.pending = stream.pending.subarray(index); }
    const end = stream.pending.indexOf(10, this.prefix.length);
    if (end < 0) {
      if (stream.pending.length > 256 * 1024) throw failure("Session completion trailer exceeds its limit");
      return;
    }
    if (end > 256 * 1024) throw failure("Session completion trailer exceeds its limit");
    const trailerBytes = stream.pending.subarray(this.prefix.length, end);
    if (trailerBytes.some(byte => byte > 127)) throw failure("Session completion trailer must be ASCII");
    const trailer = trailerBytes.toString("ascii").replace(/\r$/, "");
    if (name === "stderr") {
      if (trailer !== "END") throw failure("Invalid stderr completion boundary");
    } else {
      const match = /^(0|[1-9][0-9]{0,9}):([A-Za-z0-9+/]*={0,2})$/.exec(trailer);
      if (!match || Number(match[1]) > 2147483647) throw failure("Invalid stdout completion boundary");
      const cwdBytes = Buffer.from(match[2], "base64");
      if (cwdBytes.toString("base64") !== match[2]) throw failure("Invalid session cwd encoding");
      let cwd;
      try { cwd = new TextDecoder("utf-8", { fatal: true }).decode(cwdBytes); }
      catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-output.cjs',line:59}); throw failure("Session cwd is not valid UTF-8"); }
      if (!cwd || cwd.includes("\0")) throw failure("Invalid session cwd");
      this.result = { exitCode: Number(match[1]), cwd };
    }
    stream.ended = true;
    const extra = stream.pending.subarray(end + 1); stream.pending = Buffer.alloc(0);
    if (extra.length) this.onExtra(name, extra);
    if (!this.done && this.streams.stdout.ended && this.streams.stderr.ended) {
      this.done = true;
      this.onComplete({ ...this.result, output: Object.fromEntries(Object.entries(this.streams).map(([key, value]) =>
        [key, { totalBytes: value.totalBytes, storedBytes: value.storedBytes, truncated: value.truncated }])) });
    }
  }
  close() {
    if (!this.done || this.failed) throw Object.assign(Error("Session shell ended before valid output boundaries"), { code: "SESSION_COMMAND_UNKNOWN" });
  }
}
module.exports = { SessionOutput };
