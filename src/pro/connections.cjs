"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
const { read, write, id } = require("./store.cjs");

function fault(code, message, retryable = false) {
  return Object.assign(Error(message), { code, retryable, phase: "connection" });
}
function requestId(value) {
  if (typeof value !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))
    throw fault("INVALID_REQUEST", "A UUID requestId is required");
  return value;
}
class Connections {
  constructor(agent) {
    this.agent = agent;
    this.tasks = new Map();
  }
  file(key) { return this.agent.file("connection-tasks/" + requestId(key) + ".json"); }
  save(task) {
    const { pending, ...record } = task;
    write(this.file(task.connectionTaskId), record);
  }
  result(task) {
    const { requestHash, bootId, pending, ...value } = task;
    if (value.state === "connecting" && value.deviceId &&
        this.agent.targets.get(value.deviceId)?.state === "remote_busy") {
      value.state = "waiting_approval";
      value.phase = "admission";
    }
    return value;
  }
  get(key) {
    const task = this.tasks.get(key) || read(this.file(key), null);
    if (!task) throw fault("CONNECTION_NOT_FOUND", "Unknown connection task");
    if (task.bootId !== this.agent.bootId && !["ready", "failed", "unknown"].includes(task.state)) {
      task.state = "unknown";
      task.ok = false;
      task.error = { code: "CONNECTION_INTERRUPTED", phase: "connection",
        message: "Agent restarted before this connection request completed; query the device before a new request",
        retryable: false };
      this.save(task);
    }
    return task;
  }
  async connect(data) {
    const key = requestId(data.requestId);
    const hasCode = typeof data.code === "string" && data.code.trim().length > 0;
    const hasDevice = typeof data.deviceId === "string" && data.deviceId.length > 0;
    if (hasCode === hasDevice || (data.code !== undefined && !hasCode) ||
        (data.deviceId !== undefined && !hasDevice))
      throw fault("INVALID_REQUEST", "Provide exactly one of code or deviceId");
    const spec = hasCode ? { code: data.code.trim() } : { deviceId: id(data.deviceId) };
    if (hasCode && spec.code.length > 256) throw fault("INVALID_REQUEST", "Invalid pairing code");
    const waitMs = data.waitMs === undefined ? 20000 : data.waitMs;
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 20000)
      throw fault("INVALID_REQUEST", "waitMs must be between 0 and 20000");
    const hash = crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");
    let task = this.tasks.get(key) || read(this.file(key), null);
    if (task) {
      if (task.requestHash !== hash) throw fault("REQUEST_CONFLICT", "requestId was used for different connection input");
      task = this.get(key);
    } else {
      if (this.tasks.size >= 1024) throw fault("CONNECTION_CAPACITY", "Connection request capacity reached", true);
      task = { ok: true, connectionTaskId: key, deviceId: spec.deviceId || null,
        state: "connecting", phase: hasCode ? "pairing" : "connecting",
        requestHash: hash, bootId: this.agent.bootId, createdAt: Date.now() };
      this.save(task);
      this.tasks.set(key, task);
      task.pending = this.run(task, spec);
      task.pending.catch(() => {});
    }
    if (task.pending && waitMs) {
      let timer;
      try {
        await Promise.race([task.pending, new Promise(resolve => {
          timer = setTimeout(resolve, waitMs);
        })]);
      } finally { clearTimeout(timer); }
    }
    return this.result(task);
  }
  async run(task, spec) {
    try {
      if (spec.code) task.deviceId = (await this.agent.joinPair(spec.code)).deviceId;
      else {
        const registry = this.agent.registry(), device = registry[spec.deviceId];
        if (!device) throw fault("DEVICE_NOT_FOUND", "Unknown paired device");
        this.agent.deviceSlots.assertCanEnable(registry, device.id);
        device.enabled = true;
        device.desiredConnected = true;
        this.agent.saveRegistry(registry);
      }
      task.phase = "connecting";
      this.save(task);
      this.agent.tick();
      const descriptor = await this.ensureReady(task.deviceId);
      task.state = "ready";
      task.phase = "ready";
      task.verifiedIdentity = { deviceId: task.deviceId, fingerprint: descriptor.fingerprint,
        hostname: descriptor.hostname, remoteUser: descriptor.remoteUser,
        platform: descriptor.platform, capabilities: descriptor.capabilities };
    } catch (error) {
      task.ok = false;
      task.state = "failed";
      task.error = { code: error.code || "CONNECTION_FAILED", phase: "connection",
        message: error.message, retryable: error.retryable === true };
    } finally {
      task.updatedAt = Date.now();
      delete task.pending;
      this.save(task);
    }
  }
  ensureReady(deviceId) {
    const a = this.agent, device = a.registry()[id(deviceId)];
    if (!device) return Promise.reject(fault("DEVICE_NOT_FOUND", "Unknown paired device"));
    const t = a.targetFor(device);
    if (t.readyPromise) return t.readyPromise;
    const task = (async () => {
      while (!a.stopping) {
        const slots = a.deviceSlots.snapshot(a.registry());
        if (!slots.active.includes(deviceId) || !a.settings.enabled)
          throw fault("DEVICE_DISCONNECTED", "Device is disabled or has no active connection slot");
        if (t.state === "identity_error")
          throw fault("IDENTITY_MISMATCH", "Device authentication or identity verification failed");
        if (t.state === "unsupported_remote")
          throw fault("UNSUPPORTED_REMOTE", "Remote must be upgraded to support admission");
        if (t.state === "online" && t.client && Date.now() - t.lastProbe < 45000)
          return this.descriptor(deviceId);
        a.tick();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw fault("AGENT_STOPPING", "Agent is stopping", true);
    })();
    t.readyPromise = task;
    task.finally(() => { if (t.readyPromise === task) t.readyPromise = null; }).catch(() => {});
    return task;
  }
  descriptor(deviceId) {
    const a = this.agent, key = id(deviceId), t = a.targets.get(key);
    if (!a.registry()[key]) throw fault("DEVICE_NOT_FOUND", "Unknown paired device");
    if (!a.settings.enabled || !a.deviceSlots.snapshot(a.registry()).active.includes(key))
      throw fault("DEVICE_DISCONNECTED", "Device is disabled or has no active connection slot");
    if (t?.state !== "online" || !t.client || Date.now() - t.lastProbe >= 45000)
      throw fault(t?.state === "remote_busy" ? "WAITING_APPROVAL" : "DEVICE_NOT_READY",
        "Device has no current verified connection", true);
    const info = a.safeInfo(read(path.join(t.dir, "identity.json")));
    const runtime = read(path.join(t.dir, "runtime.json"));
    const peer = read(path.join(t.dir, "peer.json"));
    if (!runtime || runtime.port !== t.port || !Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535 ||
        !peer || peer.fingerprint !== info.fingerprint || Date.now() - peer.receivedAt >= 45000)
      throw fault("DEVICE_NOT_READY", "Relay descriptor is stale", true);
    return { deviceId: key, generation: t.generation, agentBootId: a.bootId, host: "127.0.0.1", port: runtime.port,
      keyPath: path.join(t.dir, "client_key"), knownHosts: path.join(t.dir, "known_hosts"),
      fingerprint: info.fingerprint, platform: info.target === "win10" ? "windows" : "linux",
      remoteUser: t.remoteUser, hostname: info.hostname, capabilities: peer.capabilities || {},
      permissions: peer.permissions || null, relayProtocol: peer.relayProtocol || 1,
      peerReceivedAt: peer.receivedAt, folder: t.dir };
  }
}
module.exports = { Connections, fault, requestId };
