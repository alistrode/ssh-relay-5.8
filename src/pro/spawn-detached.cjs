"use strict";
// Windows process creation can block even when child_process.spawn is asynchronous.
// Keep CreateProcess and bootstrap-log I/O outside Electron's main thread.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
if (!isMainThread && workerData?.relayDetachedSpawn) {
  const fs = require('node:fs');
  let fd;
  try {
    fd = fs.openSync(workerData.logFile, 'a', 0o600);
    const child = require('node:child_process').spawn(workerData.executable, workerData.args, {
      stdio: ['ignore', fd, fd], detached: true, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SSH_RELAY_CLIENT_PROFILE: workerData.profile },
    });
    let settled = false;
    const closeLog = () => { if (fd !== undefined) { fs.closeSync(fd); fd = undefined; } };
    child.once('error', error => { closeLog(); if (!settled) { settled = true; parentPort.postMessage({ error: { message: error.message, stack: error.stack, code: error.code } }); parentPort.close(); } });
    child.once('spawn', () => { closeLog(); child.unref(); settled = true; parentPort.postMessage({ pid: child.pid }); parentPort.close(); });
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    parentPort.postMessage({ error: { message: error.message, stack: error.stack, code: error.code } });
    parentPort.close();
  }
} else {
  exports.spawnDetached = (executable, args, { logFile, profile }) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { relayDetachedSpawn: true, executable, args, logFile, profile } });
    let settled = false;
    worker.once('message', value => { settled = true; value.error ? reject(Object.assign(new Error(value.error.message), value.error)) : resolve(value.pid); });
    worker.once('error', error => { settled = true; reject(error); });
    worker.once('exit', code => { if (!settled) reject(new Error('Background spawn worker exited before reporting its result: ' + code)); });
  });
}
