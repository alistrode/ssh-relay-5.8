"use strict";
const fs = require("node:fs"), path = require("node:path");
const { TransferSnapshots, identity } = require("./file-transfer.cjs");
const { operationId } = require("./task-spec.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
class RemoteDownloads {
  constructor(files) { this.files = files; this.snapshots = new TransferSnapshots(path.join(files.dir, "download-snapshots")); }
  prepare(owner, p) {
    this.files.check(owner); operationId(p.transferId);
    const source = this.files.target(p.source), info = fs.lstatSync(source);
    if (info.size > 4096 * 1024 * 1024) throw Object.assign(Error("Download snapshot exceeds recovery capacity"), { code: "TRANSFER_CAPACITY" });
    const file = path.join(this.snapshots.directory(p.transferId), "owner.json");
    if (fs.existsSync(file)) {
      const r = privateJSON(file);
      if (r.owner !== owner || r.source !== source) throw Object.assign(Error("Download ID belongs to a different source"), { code: "REQUEST_CONFLICT" });
      return this.status(owner, p.transferId);
    }
    this.snapshots.create({ transferId: p.transferId, deviceId: this.files.deviceId, localPath: source, remotePath: source });
    durableWrite(file, { owner, source, transferId: p.transferId });
    return this.status(owner, p.transferId);
  }
  status(owner, id) {
    this.files.check(owner); operationId(id);
    const dir = this.snapshots.directory(id), bind = privateJSON(path.join(dir, "owner.json"), null);
    if (!bind || bind.owner !== owner || bind.transferId !== id) throw Object.assign(Error("Unknown download"), { code: "TRANSFER_NOT_FOUND" });
    const r = this.snapshots.record(id);
    if (JSON.stringify(identity(fs.lstatSync(bind.source))) !== JSON.stringify(r.sourceIdentity))
      throw Object.assign(Error("Remote source changed after snapshot"), { code: "SOURCE_CHANGED" });
    return { transferId: id, deviceId: this.files.deviceId, direction: "download", source: bind.source,
      snapshot: path.join(dir, "snapshot.bin"), size: r.size, sha256: r.sha256, blocks: r.blocks,
      blockBytes: r.blockBytes, state: "prepared" };
  }
}
module.exports = { RemoteDownloads };
