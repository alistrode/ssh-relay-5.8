import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { statePath } from "./state.js";
import { connect, sftp, sftpCall } from "./transport.js";
const require = createRequire(import.meta.url);
const { TransferSnapshots } = require("../pro/file-transfer.cjs");
const { openControl } = require("../pro/agent-control.cjs");
function snapshots() { return new TransferSnapshots(statePath("transfers")); }
export async function uploadSnapshot(server, localPath, remotePath) {
  const conn = await connect(server), transferId = crypto.randomUUID();
  const r = snapshots().create({ transferId, deviceId: conn.config.agentDeviceId, localPath, remotePath, policy: "overwrite" });
  return resumeUpload(server, r.transferId);
}
export async function resumeUpload(server, transferId, { statusOnly = false } = {}) {
  const store = snapshots(), r = store.validate(transferId), conn = await connect(server);
  if (conn.config.agentDeviceId !== r.deviceId || conn.config.capabilities.fileProtocol !== 1)
    throw Object.assign(Error("Transfer target differs or does not support recovery"), { transferId });
  const control = await openControl(conn.client, r.deviceId);
  try {
    let state;
    try { state = await control.request("file.status", { transferId }); }
    catch (e) {
      if (statusOnly || e.code !== "TRANSFER_NOT_FOUND") throw e;
      state = await control.request("file.prepare", { transferId, target: r.remotePath, size: r.size,
        sha256: r.sha256, blocks: r.blocks, policy: r.policy });
    }
    const canonical = value => conn.config.platform === "windows" ? value.replaceAll("\\", "/").replace(/^\/([a-z]:\/)/i, "$1").toLowerCase() : value;
    const check = value => {
      if (value.transferId !== transferId || value.deviceId !== r.deviceId || value.size !== r.size ||
          value.sha256 !== r.sha256 || canonical(value.target) !== canonical(r.remotePath) || value.blockBytes !== r.blockBytes)
        throw Error("Transfer status differs from saved snapshot");
      return value;
    };
    check(state);
    if (statusOnly) return { ...state, localPath: r.sourcePath, persistent: true };
    if (state.state !== "completed") {
      if (state.state !== "prepared") throw Error("Transfer outcome requires inspection before continuing");
      const s = await sftp(server), handle = await sftpCall(s, "open", state.temporary, "r+");
      try {
        for (let i = 0; i < r.blocks.length; i++) {
          // Even an acknowledged block is re-read/hash-checked remotely before
          // it is skipped; changed temporary data must be repaired from snapshot.
          if (state.confirmed?.[i] === r.blocks[i]) {
            try { await control.request("file.block", { transferId, index: i, sha256: r.blocks[i] }); continue; }
            catch (e) { if (!["TRANSFER_BLOCK_MISMATCH", "TRANSFER_BLOCK_INCOMPLETE"].includes(e.code)) throw e; }
          }
          const bytes = store.block(transferId, i);
          await sftpCall(s, "write", handle, bytes, 0, bytes.length, i * r.blockBytes);
          await control.request("file.block", { transferId, index: i, sha256: r.blocks[i] });
        }
      } finally { await sftpCall(s, "close", handle).catch(() => {}); }
      state = check(await control.request("file.commit", { transferId }));
    }
    return { success: true, localPath: r.sourcePath, remotePath: state.target, bytes: r.size,
      transferId, persistent: true, completed: state.state === "completed", sha256: r.sha256 };
  } catch (error) {
    throw Object.assign(error, { transferId, deviceId: r.deviceId });
  } finally { control.close(); }
}
