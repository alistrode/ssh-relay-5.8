import path from "node:path";
import { createRequire } from "node:module";
const { ensureAgent } = createRequire(import.meta.url)("../pro/agent-client.cjs");

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
    },
  };
}

// Discovery is authenticated through the same local API used by the Pro CLI.
// Only reports from an online, admitted device are supplied to the existing
// fingerprint/hostname/account verification path in config and transport.
export async function agentServers(dir) {
  const client = await ensureAgent({ role: "near", ...(dir ? { dir: path.resolve(dir) } : {}) });
  const status = await client.request("GET", "/status");
  if (status.role !== "near" || !Array.isArray(status.devices))
    throw Error("A near Agent is required for MCP");
  const servers = Object.create(null);
  for (const device of status.devices) {
    if (!device.enabled || device.slotPaused || !status.settings?.enabled ||
        device.state !== "online" || !device.connectionReport) continue;
    if (!/^[a-f0-9-]{36}$/.test(device.id))
      throw Error("Invalid Agent device identity");
    servers["device-" + device.id] = {
      connection: device.connectionReport,
      description: device.label || "",
    };
  }
  return servers;
}
