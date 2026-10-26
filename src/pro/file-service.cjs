"use strict";
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { operationId } = require("./task-spec.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
// Hashing/copying large files must not block Agent heartbeats and device recovery.
class FileService {
  constructor({ dir, deviceId, authorized, authorizedFile }) {
    this.dir = path.resolve(dir); this.deviceId = operationId(deviceId);
    this.authorized = authorized; this.authorizedFile = path.resolve(authorizedFile);
    this.active = 0; this.queue = []; this.busy = new Set();
  }
  handle(owner, method, params) {
    operationId(owner); const id = operationId(params.transferId);
    if (!this.authorized(owner)) return Promise.reject(failure("AUTH_REVOKED", "Transfer authorization is unavailable"));
    if (this.busy.has(id)) return Promise.reject(failure("TRANSFER_BUSY", "A request for this transfer is still in progress; query the same ID"));
    if (this.queue.length >= 64) return Promise.reject(failure("TRANSFER_CAPACITY", "File service request queue is full"));
    this.busy.add(id);
    return new Promise((resolve, reject) => {
      this.queue.push({ owner, method, params, id, resolve, reject }); this.drain();
    });
  }
  drain() {
    while (this.active < 2 && this.queue.length) {
      const request = this.queue.shift();
      if (!this.authorized(request.owner)) {
        this.busy.delete(request.id); request.reject(failure("AUTH_REVOKED", "Transfer authorization was revoked")); continue;
      }
      this.active++; let settled = false, worker;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        this.active--; this.busy.delete(request.id);
        if (error) request.reject(error); else request.resolve(value);
        this.drain();
      };
      try {
        worker = new Worker(path.join(__dirname, "file-worker.cjs"), { workerData: {
          dir: this.dir, deviceId: this.deviceId, authorizedFile: this.authorizedFile,
          owner: request.owner, method: request.method, params: request.params } });
        worker.once("message", message => {
          if (!message || typeof message.ok !== "boolean") return finish(failure("TRANSFER_WORKER_FAILED", "File service returned an invalid receipt"));
          if (message.ok) finish(null, message.value);
          else finish(failure(message.code || "TRANSFER_STORAGE_FAILED", message.message || "File service request failed"));
        });
        worker.once("error", () => finish(failure("TRANSFER_WORKER_FAILED", "File service worker failed; query the original transfer ID")));
        worker.once("exit", () => finish(failure("TRANSFER_OUTCOME_UNKNOWN", "File service worker exited without a receipt; query the original transfer ID")));
      } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'file-service.cjs',line:47}); finish(failure("TRANSFER_WORKER_FAILED", "File service worker could not start")); }
    }
  }
}
module.exports = { FileService };
