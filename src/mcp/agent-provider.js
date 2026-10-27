import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { ensureAgent, stateDirectory } = createRequire(import.meta.url)("../pro/agent-client.cjs");

export function createAgentDiscovery(load) {
  let current = Object.create(null);
  let generation = 0;
  return {
    snapshot: () => current,
    async refresh() {
      const ticket = ++generation;
      current = Object.create(null);
      const next = await load();
      if (ticket !== generation)
        throw Error("Agent discovery superseded by a newer request; retry");
      current = next;
      return next;
    },
  };
}
export function agentClient(dir) {
  return ensureAgent({ role: "near", ...(dir ? { dir: path.resolve(dir) } : {}) });
}
function bindings(dir) {
  const file = path.join(stateDirectory({ dir, role: "near" }), "server-bindings.json");
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  if (value.schemaVersion !== 1 || !value.servers || Array.isArray(value.servers) ||
      typeof value.servers !== "object") throw Error("Invalid server bindings");
  const result = Object.create(null), used = new Set(), names = new Set();
  for (const [raw, entry] of Object.entries(value.servers)) {
    const name = raw.toLowerCase();
    if (!/^[a-zA-Z0-9_-]+$/.test(raw) || !entry ||
        !/^[a-f0-9-]{36}$/.test(entry.deviceId) || names.has(name) || used.has(entry.deviceId))
      throw Error("Conflicting or invalid server binding");
    names.add(name); used.add(entry.deviceId);
    result[entry.deviceId] = name;
  }
  return result;
}
export function descriptorConfig(descriptor, base, allowCloudSelfTest = false) {
  if (descriptor.applicationRelease !== "5.7" || descriptor.relayProtocol !== 57 || descriptor.deviceId !== base.deviceId || descriptor.host !== "127.0.0.1" ||
      !Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535 ||
      !Number.isSafeInteger(descriptor.generation) || descriptor.generation < 0 ||
      typeof descriptor.agentBootId !== "string" || !descriptor.agentBootId || descriptor.agentBootId.length > 128 ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(descriptor.fingerprint) ||
      !["windows", "linux"].includes(descriptor.platform) ||
      typeof descriptor.remoteUser !== "string" || !descriptor.remoteUser ||
      typeof descriptor.hostname !== "string" || !descriptor.hostname ||
      typeof descriptor.keyPath !== "string" || !path.isAbsolute(descriptor.keyPath))
    throw Error("Invalid verified Agent descriptor");
  if (!allowCloudSelfTest && descriptor.hostname.toLowerCase() === os.hostname().toLowerCase())
    throw Error("Cloud self-test target refused");
  return Object.freeze({ ...base, ...descriptor, agentManaged: true, state: "online",
    agentDeviceId: base.deviceId, user: "relay", mode: base.mode || "unrestricted",
    group: base.group || "", description: base.description || "", defaultDir: base.defaultDir || "" });
}
export async function agentServers(dir, allowCloudSelfTest = false) {
  const client = await agentClient(dir);
  const status = await client.deviceSnapshot();
  if (!status.ok || !Array.isArray(status.devices)) throw Error("Invalid Agent device list");
  const names = bindings(dir), servers = Object.create(null);
  for (const device of status.devices) {
    if (!/^[a-f0-9-]{36}$/.test(device.id)) throw Error("Invalid Agent device identity");
    const name = names[device.id] || "device-" + device.id;
    if (Object.hasOwn(servers, name)) throw Error("Conflicting Agent server names");
    const base = {
      name, deviceId: device.id, agentDeviceId: device.id, agentManaged: true,
      hostname: device.hostname || "", remoteUser: device.remoteUser || "",
      platform: device.target === "win10" ? "windows" : "linux",
      state: device.state, enabled: device.enabled, slotPaused: device.slotPaused,
      generation: device.generation, lastVerifiedAt: device.lastVerifiedAt,
      group: "", description: device.label || "", defaultDir: "", mode: "unrestricted",
      permissions: device.permissionSnapshot || null, capabilities: {}, relayProtocol: 0, peerReceivedAt: 0,
    };
    servers[name] = Object.freeze(base);
  }
  // Only ready devices need private descriptors. Offline devices remain visible
  // with explicit state and cannot be mistaken for a verified SSH endpoint.
  await Promise.all(Object.values(servers).filter(d => d.state === "online").map(async base => {
    try { servers[base.name] = descriptorConfig((()=>{const error=status.descriptorErrors?.[base.deviceId];if(error)throw Object.assign(Error(error.message),{code:error.code});return status.descriptors?.[base.deviceId];})(), base, allowCloudSelfTest); }
    catch (error) {
      if (error.statusCode === 401 || /^LOCAL_/.test(error.code || "")) throw error;
      const transient = ["DEVICE_NOT_READY", "DEVICE_DISCONNECTED", "WAITING_APPROVAL", "DEVICE_NOT_FOUND"].includes(error.code);
      servers[base.name] = Object.freeze({ ...base, state: transient ? "disconnected" : "identity_error",
        lastErrorCode: error.code || "INVALID_DEVICE_DESCRIPTOR" });
    }
  }));
  return servers;
}
export async function readyAgentServer(dir, base, allowCloudSelfTest = false) {
  const client = await agentClient(dir);
  return descriptorConfig(await client.ensureReady(base.deviceId), base, allowCloudSelfTest);
}

