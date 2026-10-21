"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite, syncDirectory } = require("./task-store.cjs");
const { digest, identity, regular, BLOCK_BYTES } = require("./file-transfer.cjs");
function fail(code, message) { throw Object.assign(Error(message), { code }); }
function present(file) { try { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) fail("TRANSFER_PATH_INVALID", "Download destination must be a regular file"); return identity(s); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
class DownloadStore {
  constructor(dir) { this.dir = folder(path.resolve(dir)); }
  file(id) { return path.join(this.dir, operationId(id) + ".json"); }
  record(id) {
    const r = privateJSON(this.file(id), null);
    if (!r || r.transferId !== id || r.direction !== "download") fail("TRANSFER_NOT_FOUND", "Unknown download");
    return r;
  }
  intent(id, input) {
    const file = path.join(this.dir, operationId(id) + ".intent.json");
    if (input) {
      operationId(input.deviceId);
      if (fs.existsSync(file)) fail("REQUEST_CONFLICT", "Download intent already exists");
      durableWrite(file, { transferId: id, deviceId: input.deviceId, source: input.source, localPath: path.resolve(input.localPath) });
    }
    return privateJSON(file, null);
  }
  hasBlock(id, index) {
    const r = this.record(id);
    if (r.confirmed[index] !== r.blocks[index]) return false;
    let fd;
    try {
      fd = this.open(r); const bytes = Buffer.alloc(Math.min(BLOCK_BYTES, r.size - index * BLOCK_BYTES));
      let offset = 0;
      while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, index * BLOCK_BYTES + offset); if (!n) return false; offset += n; }
      return digest(bytes) === r.blocks[index];
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  prepare(remote, localPath) {
    operationId(remote.transferId); operationId(remote.deviceId);
    if (!Number.isSafeInteger(remote.size) || remote.size < 0 || remote.size > 4096 * BLOCK_BYTES ||
        remote.blockBytes !== BLOCK_BYTES || !/^[a-f0-9]{64}$/.test(remote.sha256) ||
        !Array.isArray(remote.blocks) || remote.blocks.length !== Math.ceil(remote.size / BLOCK_BYTES) ||
        remote.blocks.some(h => !/^[a-f0-9]{64}$/.test(h))) fail("TRANSFER_INVALID", "Invalid download manifest");
    const target = path.resolve(localPath), parent = path.dirname(target);
    if (fs.realpathSync(parent) !== parent) fail("TRANSFER_PATH_INVALID", "Download parent must not traverse links");
    if (fs.existsSync(this.file(remote.transferId))) {
      const old = this.record(remote.transferId);
      if (old.target !== target || old.deviceId !== remote.deviceId || old.sha256 !== remote.sha256 || old.size !== remote.size)
        fail("REQUEST_CONFLICT", "Download ID declaration differs");
      return old;
    }
    if (fs.readdirSync(this.dir).length >= 64) fail("TRANSFER_CAPACITY", "Retained download capacity reached");
    const temporary = path.join(parent, ".relay-part-" + remote.transferId), original = present(target);
    const fd = fs.openSync(temporary, "wx", 0o600); let temporaryIdentity;
    try { fs.fsyncSync(fd); temporaryIdentity = identity(fs.fstatSync(fd)); } finally { fs.closeSync(fd); }
    const r = { ...remote, target, temporary, original, temporaryIdentity, confirmed: {}, state: "prepared", direction: "download" };
    durableWrite(this.file(r.transferId), r); return r;
  }
  open(r) {
    const fd = regular(r.temporary, fs.constants.O_RDWR), info = identity(fs.fstatSync(fd));
    if (info.dev !== r.temporaryIdentity.dev || info.ino !== r.temporaryIdentity.ino) { fs.closeSync(fd); fail("TRANSFER_CORRUPT", "Download temporary changed"); }
    return fd;
  }
  block(id, index, bytes) {
    const r = this.record(id);
    if (r.state !== "prepared" || !Number.isInteger(index) || index < 0 || index >= r.blocks.length ||
        bytes.length !== Math.min(BLOCK_BYTES, r.size - index * BLOCK_BYTES) || digest(bytes) !== r.blocks[index])
      fail("TRANSFER_BLOCK_MISMATCH", "Download block differs from source snapshot");
    const fd = this.open(r);
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const n = fs.writeSync(fd, bytes, offset, bytes.length - offset, index * BLOCK_BYTES + offset);
        if (!n) fail("TRANSFER_STORAGE_FAILED", "Download write made no progress"); offset += n;
      }
      fs.fsyncSync(fd); r.confirmed[index] = r.blocks[index]; durableWrite(this.file(id), r);
    } finally { fs.closeSync(fd); }
  }
  cancel(id) {
    const r = this.record(id);
    if (!["completed", "committing"].includes(r.state)) { r.state = "cancelled"; durableWrite(this.file(id), r); }
    return r;
  }
  commit(id) {
    const r = this.record(id);
    if (r.state === "completed") return r;
    if (r.state !== "prepared") fail("TRANSFER_OUTCOME_UNKNOWN", "Download commit outcome is unknown");
    if (Object.keys(r.confirmed).length !== r.blocks.length) fail("TRANSFER_BLOCK_INCOMPLETE", "Download blocks are incomplete");
    const fd = this.open(r);
    try {
      const before = identity(fs.fstatSync(fd)), hash = crypto.createHash("sha256"), bytes = Buffer.alloc(BLOCK_BYTES);
      if (before.size !== r.size) fail("TRANSFER_CORRUPT", "Download size differs");
      let position = 0;
      while (position < r.size) { const n = fs.readSync(fd, bytes, 0, Math.min(bytes.length, r.size - position), position); if (!n) fail("TRANSFER_CORRUPT", "Download ended unexpectedly"); hash.update(bytes.subarray(0, n)); position += n; }
      if (hash.digest("hex") !== r.sha256 || JSON.stringify(before) !== JSON.stringify(identity(fs.fstatSync(fd)))) fail("TRANSFER_CORRUPT", "Download complete hash differs");
      fs.fsyncSync(fd); r.commitIdentity = identity(fs.fstatSync(fd));
    } finally { fs.closeSync(fd); }
    if (JSON.stringify(present(r.target)) !== JSON.stringify(r.original) || JSON.stringify(present(r.temporary)) !== JSON.stringify(r.commitIdentity))
      fail("DESTINATION_CHANGED", "Download destination or temporary changed");
    r.state = "committing"; durableWrite(this.file(id), r);
    fs.renameSync(r.temporary, r.target); r.directoryFsync = syncDirectory(path.dirname(r.target));
    r.state = "completed"; durableWrite(this.file(id), r); return r;
  }
}
module.exports = { DownloadStore };
