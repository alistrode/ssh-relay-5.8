"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { FileService } = require("../../src/pro/file-service.cjs");
const { digest } = require("../../src/pro/file-transfer.cjs");
test("actual file worker prepares and cancels one owner-bound transfer without taking Agent event loop", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-file-worker-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const owner = crypto.randomUUID(), deviceId = crypto.randomUUID(), transferId = crypto.randomUUID(), authorizedFile = path.join(dir, "authorized.json");
  fs.writeFileSync(authorizedFile, JSON.stringify({ [owner]: {} }));
  const service = new FileService({ dir: path.join(dir, "transfers"), deviceId, authorizedFile, authorized: () => true });
  let heartbeat = false; setImmediate(() => { heartbeat = true; });
  const prepared = await service.handle(owner, "file.prepare", { transferId, target: path.join(dir, "target"), size: 0,
    sha256: digest(Buffer.alloc(0)), blocks: [], policy: "overwrite" });
  assert.equal(heartbeat, true); assert.equal(prepared.state, "prepared");
  assert.equal((await service.handle(owner, "file.cancel", { transferId })).state, "cancelled");
  assert.equal(fs.existsSync(prepared.temporary), true);
  fs.writeFileSync(authorizedFile, "{}");
  await assert.rejects(service.handle(owner, "file.status", { transferId }), { code: "AUTH_REVOKED" });
});
