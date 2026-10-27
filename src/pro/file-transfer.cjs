"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite, syncDirectory } = require("./task-store.cjs");
const BLOCK_BYTES = 1024 * 1024;
function failure(code, message) { return Object.assign(Error(message), { code }); }
function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function identity(s) { return { dev: String(s.dev), ino: String(s.ino), size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function regular(file, flags) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw failure("TRANSFER_PATH_INVALID", "Transfer source must be a regular file");
  const fd = fs.openSync(file, flags | (fs.constants.O_NOFOLLOW || 0));
  const opened = fs.fstatSync(fd);
  if (!same(identity(before), identity(opened))) { fs.closeSync(fd); throw failure("SOURCE_CHANGED", "Transfer source changed while opening"); }
  return fd;
}
// Local immutable upload snapshot. No free-space inspection or automatic expiry.
class TransferSnapshots {
  constructor(dir) { this.dir = folder(path.resolve(dir)); }
  directory(id) { return path.join(this.dir, operationId(id)); }
  record(id) {
    const dir = this.directory(id), r = privateJSON(path.join(dir, "manifest.json"), null);
    if (!r || r.transferId !== id || r.schemaVersion !== 1 || r.direction !== "upload" ||
        r.blockBytes !== BLOCK_BYTES || !Number.isSafeInteger(r.size) || r.size < 0 ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || !Array.isArray(r.blocks) || r.blocks.length !== Math.ceil(r.size / BLOCK_BYTES) ||
        r.blocks.some(h => !/^[a-f0-9]{64}$/.test(h)))
      throw failure("TRANSFER_CORRUPT", "Upload snapshot metadata is incomplete");
    operationId(r.deviceId); return r;
  }
  create({ transferId, deviceId, localPath, remotePath, policy = "overwrite" }) {
    operationId(transferId); operationId(deviceId);
    if (typeof localPath !== "string" || localPath.includes("\0") || typeof remotePath !== "string" || !remotePath ||
        remotePath.includes("\0") || !["overwrite", "reject", "rename"].includes(policy))
      throw failure("TRANSFER_INVALID", "Invalid upload snapshot request");
    const dir = this.directory(transferId), sourcePath = path.resolve(localPath);
    if (fs.existsSync(dir)) {
      const r = this.record(transferId);
      if (r.deviceId !== deviceId || r.sourcePath !== sourcePath || r.remotePath !== remotePath || r.policy !== policy)
        throw failure("REQUEST_CONFLICT", "Transfer ID belongs to another upload");
      this.validate(transferId); return r;
    }
    if (fs.readdirSync(this.dir).length >= 64) throw failure("TRANSFER_CAPACITY", "Retained upload snapshot capacity reached");
    fs.mkdirSync(dir, { mode: 0o700 });
    let input, output;
    try {
      input = regular(sourcePath, fs.constants.O_RDONLY);
      const initial = identity(fs.fstatSync(input));
      if (!Number.isSafeInteger(initial.size) || initial.size < 0) throw failure("TRANSFER_INVALID", "Unsupported source size");
      output = fs.openSync(path.join(dir, "snapshot.bin"), "wx", 0o600);
      const buffer = Buffer.alloc(BLOCK_BYTES), blocks = [], full = crypto.createHash("sha256");
      let position = 0;
      while (position < initial.size) {
        const length = Math.min(BLOCK_BYTES, initial.size - position); let read = 0;
        while (read < length) {
          const n = fs.readSync(input, buffer, read, length - read, position + read);
          if (!n) throw failure("SOURCE_CHANGED", "Source ended during snapshot");
          read += n;
        }
        const bytes = buffer.subarray(0, length); full.update(bytes); blocks.push(digest(bytes));
        let written = 0;
        while (written < length) {
          const n = fs.writeSync(output, bytes, written, length - written, position + written);
          if (!n) throw failure("TRANSFER_STORAGE_FAILED", "Snapshot write made no progress");
          written += n;
        }
        position += length;
      }
      if (!same(initial, identity(fs.fstatSync(input))) || !same(initial, identity(fs.lstatSync(sourcePath))))
        throw failure("SOURCE_CHANGED", "Source changed during snapshot");
      fs.fsyncSync(output); fs.closeSync(output); output = undefined;
      const r = { schemaVersion: 1, direction: "upload", transferId, deviceId, sourcePath, remotePath, policy,
        sourceIdentity: initial, size: initial.size, blockBytes: BLOCK_BYTES, sha256: full.digest("hex"), blocks,
        createdAt: Date.now(), state: "prepared" };
      durableWrite(path.join(dir, "manifest.json"), r); syncDirectory(dir); return r;
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'file-transfer.cjs',line:77});
      // Partial snapshots remain isolated, never presented as prepared or reused.
      if (error.code?.startsWith("TRANSFER_") || error.code === "SOURCE_CHANGED") throw error;
      throw failure("TRANSFER_STORAGE_FAILED", "Could not save upload snapshot");
    } finally {
      if (input !== undefined) fs.closeSync(input);
      if (output !== undefined) fs.closeSync(output);
    }
  }
  block(id, index, validatedRecord = null) {
    const r = validatedRecord || this.record(id);
    if(r.transferId!==id)throw failure("TRANSFER_CORRUPT","Snapshot record identity differs");
    if (!Number.isInteger(index) || index < 0 || index >= r.blocks.length) throw failure("TRANSFER_INVALID", "Invalid snapshot block index");
    const fd = regular(path.join(this.directory(id), "snapshot.bin"), fs.constants.O_RDONLY);
    try {
      if (fs.fstatSync(fd).size !== r.size) throw failure("TRANSFER_CORRUPT", "Snapshot size changed");
      const position = index * BLOCK_BYTES, bytes = Buffer.alloc(Math.min(BLOCK_BYTES, r.size - position));
      let read = 0;
      while (read < bytes.length) {
        const n = fs.readSync(fd, bytes, read, bytes.length - read, position + read);
        if (!n) throw failure("TRANSFER_CORRUPT", "Snapshot block is incomplete");
        read += n;
      }
      if (digest(bytes) !== r.blocks[index]) throw failure("TRANSFER_CORRUPT", "Snapshot block hash differs");
      return bytes;
    } finally { fs.closeSync(fd); }
  }
  validate(id) {
    const r=this.record(id),full=crypto.createHash("sha256"),file=path.join(this.directory(id),"snapshot.bin");
    const fd=regular(file,fs.constants.O_RDONLY),initial=identity(fs.fstatSync(fd));
    try{
      if(initial.size!==r.size)throw failure("TRANSFER_CORRUPT","Snapshot size changed");
      for(let i=0;i<r.blocks.length;i++){
        const bytes=Buffer.alloc(Math.min(BLOCK_BYTES,r.size-i*BLOCK_BYTES));let offset=0;
        while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,i*BLOCK_BYTES+offset);if(!n)throw failure("TRANSFER_CORRUPT","Snapshot block is incomplete");offset+=n;}
        if(digest(bytes)!==r.blocks[i])throw failure("TRANSFER_CORRUPT","Snapshot block hash differs");
        full.update(bytes);
      }
      if(full.digest("hex")!==r.sha256||!same(initial,identity(fs.fstatSync(fd)))||!same(initial,identity(fs.lstatSync(file))))throw failure("TRANSFER_CORRUPT","Snapshot complete hash or identity differs");
      return r;
    }finally{fs.closeSync(fd);}
  }
}
module.exports = { TransferSnapshots, BLOCK_BYTES, digest, identity, regular };
