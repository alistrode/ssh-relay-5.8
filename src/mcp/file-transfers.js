import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { statePath } from "./state.js";
import { connect, sftp, sftpCall, transportStopping } from "./transport.js";
const require = createRequire(import.meta.url);
const { TransferSnapshots } = require("../pro/file-transfer.cjs");
const { openControl } = require("../pro/agent-control.cjs");
const {run:localFileJob}=require("../pro/local-file-job.cjs");
function snapshots() { return new TransferSnapshots(statePath("transfers")); }
async function recoverTransfer(work){
  let failures=0;
  for(;;){
    try{return await work();}catch(error){
      const code=String(error.code||""),message=String(error.message||"");
      const transient=["ECONNRESET","ECONNREFUSED","ETIMEDOUT","EPIPE","ENOTCONN","CONTROL_TIMEOUT","CONTROL_CLOSED","TRANSFER_CONNECTION_LOST","6","7"].includes(code)||
        (!code&&/connection (?:closed|lost)|channel (?:closed|not open)|socket closed|not connected|no response from server|ssh closed before identity verification|ssh connection\/identity check timeout/i.test(message));
      if(transportStopping()||!transient)throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.min(10000,1000*2**Math.min(failures++,4))));
    }
  }
}
export async function uploadSnapshot(server, localPath, remotePath) {
  const conn = await recoverTransfer(()=>connect(server)), transferId = crypto.randomUUID();
  const r = await localFileJob(statePath("transfers"),"create",{ transferId, deviceId: conn.config.agentDeviceId, localPath, remotePath, policy: "overwrite" });
  try { return await recoverTransfer(()=>resumeUpload(server, r.transferId)); }
  catch (error) { throw Object.assign(error, { transferId: r.transferId, deviceId: r.deviceId }); }
}
export async function resumeUpload(server, transferId, { statusOnly = false } = {}) {
  const store = snapshots(), r = await localFileJob(statePath("transfers"),"validate",transferId), conn = await connect(server);
  if (conn.config.agentDeviceId !== r.deviceId || conn.config.capabilities.fileProtocol !== 57)
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
          const bytes = store.block(transferId, i, r);
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

const { DownloadStore } = require("../pro/download-store.cjs");
function downloads() { return new DownloadStore(statePath("downloads")); }
export async function downloadSnapshot(server, remotePath, localPath) {
  const conn = await recoverTransfer(()=>connect(server)), transferId = crypto.randomUUID();
  downloads().intent(transferId, { deviceId: conn.config.agentDeviceId, source: remotePath, localPath });
  try { return await recoverTransfer(()=>resumeDownload(server, transferId)); }
  catch (error) { throw Object.assign(error, { transferId, deviceId: conn.config.agentDeviceId }); }
}
export async function resumeDownload(server, transferId, { statusOnly = false } = {}) {
  const store = downloads(), intent = store.intent(transferId);
  if (!intent) throw Object.assign(Error("Unknown download intent"), { transferId });
  const conn = await connect(server);
  if (conn.config.agentDeviceId !== intent.deviceId || conn.config.capabilities.fileProtocol !== 57)
    throw Object.assign(Error("Download target differs or lacks recovery"), { transferId });
  const control = await openControl(conn.client, intent.deviceId);
  try {
    let remote;
    try { remote = await control.request("file.download.status", { transferId }); }
    catch (e) {
      if (statusOnly || e.code !== "TRANSFER_NOT_FOUND") throw e;
      remote = await control.request("file.download.prepare", { transferId, source: intent.source });
    }
    if (remote.state === "cancelled") return { success: false, transferId, direction: "download", state: "cancelled", completed: false };
    if (remote.transferId !== transferId || remote.deviceId !== intent.deviceId || remote.direction !== "download")
      throw Error("Remote download identity differs");
    if (statusOnly) {
      let local; try { local = store.record(transferId); } catch (e) { if (e.code !== "TRANSFER_NOT_FOUND") throw e; }
      return { transferId, deviceId: intent.deviceId, direction: "download", state: local?.state || "registered",
        bytes: remote.size, completed: local?.state === "completed", persistent: true };
    }
    let local = store.prepare(remote, intent.localPath);
    if (local.state !== "completed") {
      if (local.state !== "prepared") throw Error("Download commit outcome needs inspection");
      const s = await sftp(server), handle = await sftpCall(s, "open", remote.snapshot, "r");
      try {
        for (let i = 0; i < remote.blocks.length; i++) {
          if (store.hasBlock(transferId, i)) continue;
          const bytes = Buffer.alloc(Math.min(remote.blockBytes, remote.size - i * remote.blockBytes));
          let offset = 0;
          while (offset < bytes.length) {
            const n = await sftpCall(s, "read", handle, bytes, offset, bytes.length - offset, i * remote.blockBytes + offset);
            if (!Number.isInteger(n) || n < 1 || n > bytes.length - offset) throw Error("Remote download block is incomplete");
            offset += n;
          }
          store.block(transferId, i, bytes);
        }
      } finally { await sftpCall(s, "close", handle).catch(() => {}); }
      const final = await control.request("file.download.status", { transferId });
      if (final.sha256 !== remote.sha256 || final.size !== remote.size || final.deviceId !== intent.deviceId)
        throw Error("Remote download source changed");
      local = store.commit(transferId);
    }
    return { success: true, transferId, persistent: true, completed: local.state === "completed",
      localPath: local.target, remotePath: intent.source, bytes: local.size, sha256: local.sha256 };
  } catch (error) { throw Object.assign(error, { transferId, deviceId: intent.deviceId }); }
  finally { control.close(); }
}
export function resumeTransfer(server, transferId, options) {
  const resume=()=>downloads().intent(transferId)?resumeDownload(server,transferId,options):resumeUpload(server,transferId,options);
  return options?.statusOnly?resume():recoverTransfer(resume);
}

export async function cancelTransfer(server, transferId) {
  const store = downloads(), intent = store.intent(transferId), upload = intent ? null : snapshots().record(transferId);
  const deviceId = intent?.deviceId || upload.deviceId, conn = await connect(server);
  if (conn.config.agentDeviceId !== deviceId) throw Object.assign(Error("Transfer target differs"), { transferId });
  const control = await openControl(conn.client, deviceId);
  try {
    const result = await control.request(intent ? "file.download.cancel" : "file.cancel", { transferId });
    if (intent) { try { store.cancel(transferId); } catch (e) { if (e.code !== "TRANSFER_NOT_FOUND") throw e; } }
    return { ...result, temporaryFilesRetained: true };
  } catch (error) { throw Object.assign(error, { transferId }); }
  finally { control.close(); }
}
