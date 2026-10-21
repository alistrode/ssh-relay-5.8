"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { folder } = require("./store.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite, syncDirectory } = require("./task-store.cjs");
const { BLOCK_BYTES, digest, identity, regular } = require("./file-transfer.cjs");
function fail(code, message) { throw Object.assign(Error(message), { code }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function present(file) { try { return identity(fs.lstatSync(file)); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
class RemoteFiles {
  constructor({ dir, deviceId, authorized }) { this.dir = folder(path.resolve(dir)); this.deviceId = operationId(deviceId); this.authorized = authorized; this.downloads = new (require("./remote-downloads.cjs").RemoteDownloads)(this); }
  check(owner) { operationId(owner); if (!this.authorized(owner)) fail("AUTH_REVOKED", "Transfer controller authorization is unavailable"); }
  file(id) { return path.join(this.dir, operationId(id) + ".json"); }
  record(owner, id) {
    this.check(owner); const r = privateJSON(this.file(id), null);
    if (!r || r.owner !== owner || r.transferId !== id || r.deviceId !== this.deviceId) fail("TRANSFER_NOT_FOUND", "Unknown transfer");
    return r;
  }
  target(input) {
    if (process.platform === "win32" && typeof input === "string") input = input.replace(/^\/([a-z]:\/)/i, "$1");
    if (typeof input !== "string" || !input || input.includes("\0") || !path.isAbsolute(input)) fail("TRANSFER_PATH_INVALID", "Transfer requires an absolute target");
    const target = path.resolve(input), parent = path.dirname(target);
    const realParent = fs.realpathSync(parent);
    const equal = process.platform === "win32" ? realParent.toLowerCase() === parent.toLowerCase() : realParent === parent;
    if (!equal || target === parent) fail("TRANSFER_PATH_INVALID", "Transfer parent must not traverse links");
    const current = present(target);
    if (current) {
      const st = fs.lstatSync(target);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) fail("TRANSFER_PATH_INVALID", "Transfer destination must be a regular unlinked file");
    }
    return target;
  }
  prepare(owner, p) {
    this.check(owner); operationId(p.transferId);
    if (!Number.isSafeInteger(p.size) || p.size < 0 || p.size > 4096 * BLOCK_BYTES || !/^[a-f0-9]{64}$/.test(p.sha256) ||
        !Array.isArray(p.blocks) || p.blocks.length !== Math.ceil(p.size / BLOCK_BYTES) || p.blocks.some(h => !/^[a-f0-9]{64}$/.test(h)) ||
        !["overwrite", "reject", "rename"].includes(p.policy)) fail("TRANSFER_INVALID", "Invalid transfer declaration");
    const inputHash = digest(Buffer.from(JSON.stringify({ target: p.target, size: p.size, sha256: p.sha256, blocks: p.blocks, policy: p.policy })));
    if (fs.existsSync(this.file(p.transferId))) {
      const r = this.record(owner, p.transferId);
      if (r.inputHash !== inputHash) fail("REQUEST_CONFLICT", "Transfer ID declaration differs");
      return this.status(owner, p.transferId);
    }
    if (fs.readdirSync(this.dir).length >= 10000) fail("TRANSFER_CAPACITY", "Retained transfer capacity reached");
    let target = this.target(p.target);
    if (p.policy === "rename") target = this.target(target + ".relay-" + p.transferId);
    const original = present(target);
    if (p.policy !== "overwrite" && original) fail("TRANSFER_DESTINATION_EXISTS", "Transfer destination already exists");
    const temporary = path.join(path.dirname(target), ".relay-part-" + p.transferId);
    const r = { schemaVersion: 1, transferId: p.transferId, deviceId: this.deviceId, owner, inputHash,
      target, temporary, original, size: p.size, sha256: p.sha256, expected: p.blocks, confirmed: {}, policy: p.policy,
      state: "preparing", createdAt: Date.now() };
    durableWrite(this.file(p.transferId), r);
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600); fs.fsyncSync(fd);
      r.temporaryIdentity = identity(fs.fstatSync(fd)); r.state = "prepared";
      durableWrite(this.file(p.transferId), r); syncDirectory(path.dirname(target));
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    return this.status(owner, p.transferId);
  }
  open(r, flags) {
    this.target(r.target);
    const fd = regular(r.temporary, flags), st = identity(fs.fstatSync(fd));
    if (st.dev !== r.temporaryIdentity?.dev || st.ino !== r.temporaryIdentity?.ino) {
      fs.closeSync(fd); fail("TRANSFER_CORRUPT", "Transfer temporary identity changed");
    }
    return fd;
  }
  block(owner, p) {
    const r = this.record(owner, p.transferId);
    if (r.state !== "prepared" || !Number.isInteger(p.index) || p.index < 0 || p.index >= r.expected.length ||
        p.sha256 !== r.expected[p.index]) fail("TRANSFER_INVALID", "Invalid block confirmation");
    const fd = this.open(r, fs.constants.O_RDWR);
    try {
      const offset = p.index * BLOCK_BYTES, bytes = Buffer.alloc(Math.min(BLOCK_BYTES, r.size - offset)); let n = 0;
      while (n < bytes.length) { const count = fs.readSync(fd, bytes, n, bytes.length - n, offset + n); if (!count) fail("TRANSFER_BLOCK_INCOMPLETE", "Block data is incomplete"); n += count; }
      if (digest(bytes) !== p.sha256) fail("TRANSFER_BLOCK_MISMATCH", "Block hash differs");
      fs.fsyncSync(fd); r.confirmed[p.index] = p.sha256;
      durableWrite(this.file(p.transferId), r);
      return { transferId: r.transferId, index: p.index, confirmed: true };
    } finally { fs.closeSync(fd); }
  }
  status(owner, id) {
    const r = this.record(owner, id);
    return { transferId: id, deviceId: this.deviceId, state: r.state, target: r.target, temporary: r.temporary,
      size: r.size, sha256: r.sha256, confirmed: r.confirmed, blockBytes: BLOCK_BYTES };
  }
  commit(owner, p) {
    const r = this.record(owner, p.transferId);
    if (r.state === "completed") return this.status(owner, p.transferId);
    if (r.state !== "prepared") fail("TRANSFER_OUTCOME_UNKNOWN", "Query original transfer; commit cannot be replayed");
    if (Object.keys(r.confirmed).length !== r.expected.length) fail("TRANSFER_BLOCK_INCOMPLETE", "Blocks are not all confirmed");
    const fd = this.open(r, fs.constants.O_RDWR);
    try {
      if (fs.fstatSync(fd).size !== r.size) fail("TRANSFER_CORRUPT", "Transfer size differs");
      const beforeHash = identity(fs.fstatSync(fd));
      const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(BLOCK_BYTES); let position = 0;
      while (position < r.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, r.size - position), position);
        if (!n) fail("TRANSFER_CORRUPT", "Transfer ended unexpectedly");
        hash.update(buffer.subarray(0, n)); position += n;
      }
      if (hash.digest("hex") !== r.sha256) fail("TRANSFER_CORRUPT", "Complete transfer hash differs");
      if (!same(beforeHash, identity(fs.fstatSync(fd)))) fail("SOURCE_CHANGED", "Transfer changed during complete hash");
      fs.fsyncSync(fd);
      r.commitIdentity = identity(fs.fstatSync(fd));
      if (!same(present(r.target), r.original)) fail("DESTINATION_CHANGED", "Transfer destination changed since preparation");
      r.state = "committing"; durableWrite(this.file(p.transferId), r);
    } finally { fs.closeSync(fd); }
    this.target(r.target);
    if (!same(present(r.temporary), r.commitIdentity)) fail("TRANSFER_OUTCOME_UNKNOWN", "Transfer temporary changed before commit");
    if (r.policy === "overwrite") fs.renameSync(r.temporary, r.target);
    else fs.linkSync(r.temporary, r.target); // Atomic no-replace; retained temp is not auto-cleaned.
    r.directoryFsync = syncDirectory(path.dirname(r.target));
    r.state = "completed"; r.finishedAt = Date.now(); durableWrite(this.file(p.transferId), r);
    return this.status(owner, p.transferId);
  }
  cancel(owner, id) {
    const r = this.record(owner, id);
    if (!["completed", "committing"].includes(r.state)) { r.state = "cancelled"; durableWrite(this.file(id), r); }
    return this.status(owner, id);
  }
  handle(owner, method, p) {
    try { return this.dispatch(owner, method, p); }
    catch (error) {
      if (/^(TRANSFER_|SOURCE_CHANGED$|DESTINATION_CHANGED$|REQUEST_CONFLICT$|AUTH_REVOKED$|CONTROL_)/.test(error.code || "")) throw error;
      throw Object.assign(Error("Transfer storage operation failed; query the saved transfer ID"), { code: "TRANSFER_STORAGE_FAILED" });
    }
  }
  dispatch(owner, method, p) {
    if (method === "file.cancel") return this.cancel(owner, p.transferId);
    if (method === "file.download.cancel") return this.downloads.cancel(owner, p.transferId);
    if (method === "file.download.prepare") return this.downloads.prepare(owner, p);
    if (method === "file.download.status") return this.downloads.status(owner, p.transferId);
    if (method === "file.prepare") return this.prepare(owner, p);
    if (method === "file.status") return this.status(owner, p.transferId);
    if (method === "file.block") return this.block(owner, p);
    if (method === "file.commit") return this.commit(owner, p);
    fail("CONTROL_UNSUPPORTED_METHOD", "Unsupported transfer method");
  }
}
module.exports = { RemoteFiles };
