import path from "node:path";
import { createRequire } from "node:module";
const { request } = createRequire(import.meta.url)("../pro/agent-client.cjs");

// Discovery is authenticated through the same local API used by the Pro CLI.
// Only reports from an online, admitted device are supplied to the existing
// fingerprint/hostname/account verification path in config and transport.
export async function agentServers(dir) {
  const status = await request(path.resolve(dir), "/status");
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
