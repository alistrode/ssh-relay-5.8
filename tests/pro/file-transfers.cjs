"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { TransferSnapshots } = require("../../src/pro/file-transfer.cjs");
const { RemoteFiles } = require("../../src/pro/remote-files.cjs");
const { DownloadStore } = require("../../src/pro/download-store.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-transfer-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), deviceId = crypto.randomUUID();
  const target = path.join(root, "target.bin"), source = path.join(root, "source.bin");
  const bytes = Buffer.alloc(1024 * 1024 + 17, 37); fs.writeFileSync(source, bytes);
  const snapshots = new TransferSnapshots(path.join(root, "snapshots"));
  const files = new RemoteFiles({ dir: path.join(root, "remote"), deviceId, authorized: id => [owner, other].includes(id) });
  t.mock.method(fs, "statfsSync", () => { throw Error("Disk inspection forbidden"); });
  return { root, owner, other, deviceId, source, target, bytes, snapshots, files };
}
test("upload confirms stable hashes, binds owner, and commits the original transfer once", t => {
  const f = fixture(t), id = crypto.randomUUID();
  const r = f.snapshots.create({ transferId: id, deviceId: f.deviceId, localPath: f.source, remotePath: f.target });
  const declaration = { transferId: id, target: f.target, size: r.size, sha256: r.sha256, blocks: r.blocks, policy: r.policy };
  const prepared = f.files.prepare(f.owner, declaration);
  assert.throws(() => f.files.status(f.other, id), { code: "TRANSFER_NOT_FOUND" });
  fs.writeFileSync(f.source, "changed later; original snapshot must remain immutable");
  const fd = fs.openSync(prepared.temporary, "r+");
  try {
    for (let i = 0; i < r.blocks.length; i++) {
      const bytes = f.snapshots.block(id, i); fs.writeSync(fd, bytes, 0, bytes.length, i * r.blockBytes);
      f.files.block(f.owner, { transferId: id, index: i, sha256: r.blocks[i] });
    }
  } finally { fs.closeSync(fd); }
  const result = f.files.commit(f.owner, { transferId: id });
  assert.equal(result.state, "completed"); assert.deepEqual(fs.readFileSync(f.target), f.bytes);
  assert.equal(f.files.commit(f.owner, { transferId: id }).state, "completed");
  assert.throws(() => f.files.prepare(f.owner, { ...declaration, size: 0, blocks: [] }), { code: "REQUEST_CONFLICT" });
});
test("changed destinations and cancelled uploads never commit", t => {
  const f = fixture(t), id = crypto.randomUUID();
  const r = f.snapshots.create({ transferId: id, deviceId: f.deviceId, localPath: f.source, remotePath: f.target });
  const state = f.files.prepare(f.owner, { transferId: id, target: f.target, size: r.size, sha256: r.sha256, blocks: r.blocks, policy: r.policy });
  fs.writeFileSync(state.temporary, f.bytes);
  for (let i = 0; i < r.blocks.length; i++) f.files.block(f.owner, { transferId: id, index: i, sha256: r.blocks[i] });
  fs.writeFileSync(f.target, "new destination");
  assert.throws(() => f.files.commit(f.owner, { transferId: id }), { code: "DESTINATION_CHANGED" });
  assert.equal(f.files.cancel(f.owner, id).state, "cancelled");
  assert.throws(() => f.files.commit(f.owner, { transferId: id }), { code: "TRANSFER_OUTCOME_UNKNOWN" });
  assert.equal(fs.readFileSync(f.target, "utf8"), "new destination");
  assert.equal(fs.existsSync(state.temporary), true);
});
test("download resumes only valid blocks and refuses a changed original source", t => {
  const f = fixture(t), id = crypto.randomUUID(), target = path.join(f.root, "downloaded.bin");
  const remote = f.files.downloads.prepare(f.owner, { transferId: id, source: f.source });
  assert.throws(() => f.files.downloads.status(f.other, id), { code: "TRANSFER_NOT_FOUND" });
  const local = new DownloadStore(path.join(f.root, "downloads")), prepared = local.prepare(remote, target);
  for (let i = 0; i < remote.blocks.length; i++) local.block(id, i, f.bytes.subarray(i * remote.blockBytes, Math.min((i + 1) * remote.blockBytes, f.bytes.length)));
  assert.equal(local.hasBlock(id, 0), true);
  const fd = fs.openSync(prepared.temporary, "r+");
  try { fs.writeSync(fd, Buffer.from("x"), 0, 1, 0); } finally { fs.closeSync(fd); }
  assert.equal(local.hasBlock(id, 0), false);
  assert.throws(() => local.commit(id), { code: "TRANSFER_CORRUPT" });
  local.block(id, 0, f.bytes.subarray(0, remote.blockBytes));
  assert.equal(local.commit(id).state, "completed"); assert.deepEqual(fs.readFileSync(target), f.bytes);
  fs.appendFileSync(f.source, "change");
  assert.throws(() => f.files.downloads.status(f.owner, id), { code: "SOURCE_CHANGED" });
});
test("empty source uploads still require complete hash and preserve exact bytes", t => {
  const f = fixture(t), id = crypto.randomUUID(); fs.writeFileSync(f.source, "");
  const r = f.snapshots.create({ transferId: id, deviceId: f.deviceId, localPath: f.source, remotePath: f.target });
  f.files.prepare(f.owner, { transferId: id, target: f.target, size: r.size, sha256: r.sha256, blocks: r.blocks, policy: r.policy });
  assert.equal(f.files.commit(f.owner, { transferId: id }).state, "completed");
  assert.equal(fs.statSync(f.target).size, 0);
});
