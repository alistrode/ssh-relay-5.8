"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { read } = require("./store.cjs");
const { RemoteFiles } = require("./remote-files.cjs");
if (!parentPort || !workerData) throw Error("File service worker requires trusted startup data");
try {
  const { dir, deviceId, authorizedFile, owner, method, params } = workerData;
  const files = new RemoteFiles({ dir, deviceId,
    authorized: id => id === owner && !!read(authorizedFile, {})[id] });
  const value = files.handle(owner, method, params);
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  const known = /^(TRANSFER_|SOURCE_CHANGED$|DESTINATION_CHANGED$|REQUEST_CONFLICT$|AUTH_REVOKED$|CONTROL_)/.test(error.code || "");
  parentPort.postMessage({ ok: false, code: known ? error.code : "TRANSFER_STORAGE_FAILED",
    message: known ? error.message : "File service storage operation failed" });
}
parentPort.close();
