"use strict";
const crypto = require("node:crypto");
const pending = new Map();
let queuedBytes = 0;
function unavailable() {
  return Object.assign(Error("Far Agent control bridge unavailable; operation outcome may be unknown"),
    { code: "CONTROL_AGENT_UNAVAILABLE", retryable: true });
}
function settle(key, failure, value) {
  const request = pending.get(key);
  if (!request) return;
  pending.delete(key); clearTimeout(request.timer); queuedBytes -= request.bytes;
  if (failure) request.reject(failure); else request.resolve(value);
}
process.on("message", message => {
  if (message?.type !== "task-rpc-result") return;
  settle(message.rpcId, message.ok ? null : Object.assign(Error(message.error?.message || "Control operation failed"),
    { code: message.error?.code || "CONTROL_FAILED", retryable: message.error?.retryable === true }), message.result);
});
process.on("disconnect", () => { for (const key of pending.keys()) settle(key, unavailable()); });
function forwardControl(controllerId, method, params) {
  const bytes = Buffer.byteLength(JSON.stringify(params));
  if (!process.connected || !controllerId) return Promise.reject(unavailable());
  if (pending.size >= 32 || bytes > 1024 * 1024 || queuedBytes + bytes > 2 * 1024 * 1024)
    return Promise.reject(Object.assign(Error("Far Agent control bridge is full"), { code: "CONTROL_CAPACITY", retryable: true }));
  const rpcId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(rpcId, unavailable()), 20000);
    pending.set(rpcId, { resolve, reject, timer, bytes }); queuedBytes += bytes;
    try {
      process.send({ type: "task-rpc", rpcId, controllerId, method, params },
        failure => { if (failure) settle(rpcId, unavailable()); });
    } catch { settle(rpcId, unavailable()); }
  });
}
module.exports = { forwardControl };
