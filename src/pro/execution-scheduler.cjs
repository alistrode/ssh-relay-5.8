"use strict";
class ExecutionScheduler {
  constructor({ limit = 2, queueLimit = 64 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(queueLimit) || queueLimit < 1) throw Error("Invalid execution scheduler limits");
    this.limit = limit; this.queueLimit = queueLimit; this.providers = new Map(); this.running = false; this.occupied = 0;
  }
  register(kind, provider) {
    if (this.providers.has(kind) || typeof provider.snapshot !== "function" || typeof provider.start !== "function")
      throw Error("Invalid or duplicate execution provider");
    this.providers.set(kind, provider);
  }
  snapshot() {
    let active = 0; const queued = [];
    for (const [kind, provider] of this.providers) {
      const value = provider.snapshot();
      if (!Number.isSafeInteger(value.active) || value.active < 0 || !Array.isArray(value.queued)) throw Error("Invalid execution provider state");
      active += value.active;
      for (const request of value.queued) {
        if (typeof request.key !== "string" || !request.key || !Number.isFinite(request.createdAt)) throw Error("Invalid queued execution identity");
        queued.push({ kind, request });
      }
    }
    queued.sort((a, b) => a.request.createdAt - b.request.createdAt || a.request.key.localeCompare(b.request.key) || a.kind.localeCompare(b.kind));
    return { active, queued };
  }
  activeCount() { return this.running ? this.occupied : this.snapshot().active; }
  pendingCount() { return this.snapshot().queued.length; }
  tick() {
    if (this.running) return;
    this.running = true;
    try {
      const state = this.snapshot(); this.occupied = state.active;
      for (const item of state.queued) {
        if (this.occupied >= this.limit) break;
        // Providers must persist an execution claim before returning true.
        if (this.providers.get(item.kind).start(item.request)) this.occupied++;
      }
    } finally { this.running = false; }
  }
}
module.exports = { ExecutionScheduler };
