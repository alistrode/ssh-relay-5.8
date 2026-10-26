"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { folder } = require("./store.cjs");
const { syncDirectory } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
class SessionLog {
  constructor(directory, { limitBytes = 64 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || limitBytes > 64 * 1024 * 1024)
      throw failure("SESSION_OUTPUT_INVALID", "Invalid session output storage limit");
    this.dir = folder(path.resolve(directory)); this.limit = limitBytes; this.closed = false; this.failed = false;
    this.streams = {};
    try {
      for (const name of ["stdout", "stderr"]) this.streams[name] = {
        fd: fs.openSync(path.join(this.dir, name + ".bin"), "wx", 0o600), bytes: 0, totalBytes: 0, truncated: false };
      this.directoryFsync = syncDirectory(this.dir);
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-log.cjs',line:17});
      this.failed = true;
      for (const stream of Object.values(this.streams)) try { fs.closeSync(stream.fd); } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'session-log.cjs',line:19}); }
      throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output storage could not be created");
    }
  }
  append(name, bytes) {
    const stream = this.streams[name];
    if (!stream || !Buffer.isBuffer(bytes)) throw failure("SESSION_OUTPUT_INVALID", "Session output requires named byte buffers");
    if (this.closed || this.failed) throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output storage is unavailable");
    stream.totalBytes += bytes.length;
    const allowed = Math.min(bytes.length, Math.max(0, this.limit - stream.bytes));
    stream.truncated ||= allowed < bytes.length;
    let offset = 0;
    try {
      while (offset < allowed) {
        const count = fs.writeSync(stream.fd, bytes, offset, allowed - offset);
        if (count < 1) throw Error();
        offset += count; stream.bytes += count;
      }
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-log.cjs',line:37}); this.failed = true; throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output write failed"); }
  }
  finish() {
    if (this.closed) throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output storage is already closed");
    this.closed = true;
    for (const stream of Object.values(this.streams)) {
      try { fs.fsyncSync(stream.fd); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-log.cjs',line:43}); this.failed = true; }
      try { fs.closeSync(stream.fd); } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-log.cjs',line:44}); this.failed = true; }
    }
    if (this.failed) throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output could not be durably closed");
    return { directoryFsync: this.directoryFsync,
      ...Object.fromEntries(Object.entries(this.streams).map(([name, stream]) => [name,
        { bytes: stream.bytes, totalBytes: stream.totalBytes, truncated: stream.truncated }])) };
  }
  static page(directory, name, offset = 0, limitBytes = 65536) {
    if (!["stdout", "stderr"].includes(name) || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isInteger(limitBytes) || limitBytes < 1 || limitBytes > 65536)
      throw failure("INVALID_SESSION_CURSOR", "Session output requires valid byte offsets and a bounded page size");
    let fd;
    try {
      const file = path.join(path.resolve(directory), name + ".bin"), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024 || offset > stat.size)
        throw failure("INVALID_SESSION_CURSOR", "Session output file or cursor is invalid");
      fd = fs.openSync(file, "r");
      const bytes = Buffer.alloc(Math.min(limitBytes, stat.size - offset));
      const count = fs.readSync(fd, bytes, 0, bytes.length, offset);
      return { data: bytes.subarray(0, count).toString("base64"), nextOffset: offset + count,
        storedBytes: stat.size, outputEncoding: "base64" };
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-log.cjs',line:65});
      if (error.code === "INVALID_SESSION_CURSOR") throw error;
      throw failure("SESSION_OUTPUT_STORAGE_FAILED", "Session output page could not be read");
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
module.exports = { SessionLog };
