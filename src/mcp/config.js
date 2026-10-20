import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveServerName } from "./server-aliases.js";
import { agentServers, createAgentDiscovery } from "./agent-provider.js";
const args = process.argv.slice(2);
export function arg(name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
}
const reportPath = arg("--connection");
const manifestPath = arg("--connections");
const agentDir = arg("--agent-dir");
for (const name of ["--connection", "--connections", "--agent-dir"]) {
  const value = arg(name);
  if (args.includes(name) && (!value || value.startsWith("--")))
    throw new Error(`${name} requires a path`);
}
if ([reportPath, manifestPath, agentDir].filter(Boolean).length > 1)
  throw new Error("Use only one of --connection, --connections or --agent-dir");
const agentMode = !reportPath && !manifestPath;
const discovery = createAgentDiscovery(() => agentServers(agentDir));
export async function refreshAgentServers() {
  if (!agentMode) return;
  // Clear stale descriptors before awaiting: API failure must not leave a
  // disabled or unpaired target available through the old snapshot.
  await discovery.refresh();
}
export function servers() {
  const config = agentMode ? { servers: discovery.snapshot() } : manifestPath
    ? JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"))
    : {
        servers: reportPath
          ? { [arg("--name") || "remote"]: { connection: reportPath } }
          : {},
      };
  if (!config.servers || typeof config.servers !== "object")
    throw new Error("Expected {servers:{name:{connection:reportPath}}}");
  const result = Object.create(null);
  for (const [raw, entry] of Object.entries(config.servers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(raw)) throw new Error("Invalid server name");
    if (
      !["unrestricted", "readonly", "restricted"].includes(
        entry.securityMode || "unrestricted",
      )
    )
      throw new Error("Invalid securityMode");
    const base = manifestPath
      ? path.dirname(path.resolve(manifestPath))
      : process.cwd();
    const report = JSON.parse(
      fs.readFileSync(path.resolve(base, entry.connection), "utf8"),
    );
    if (
      !report.connected ||
      !report.state_directory ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(report.host_fingerprint)
    )
      throw new Error(`Unverified connection report for ${raw}`);
    if (report.cloud_self_test && arg("--allow-cloud-self-test") !== "yes")
      throw new Error(
        "Cloud self-test report refused. Test harness must explicitly pass --allow-cloud-self-test yes",
      );
    const folder = path.resolve(report.state_directory);
    let runtime;
    try {
      runtime = JSON.parse(
        fs.readFileSync(path.join(folder, "runtime.json"), "utf8"),
      );
    } catch (error) {
      if (!report.agent_managed || error.code !== "ENOENT") throw error;
      runtime = { port: report.local_port };
    }
    if (
      !Number.isInteger(runtime.port) ||
      runtime.port < 1 ||
      runtime.port > 65535
    )
      throw new Error("Invalid loopback relay port");
    let peer;
    try {
      peer = JSON.parse(
        fs.readFileSync(path.join(folder, "peer.json"), "utf8"),
      );
    } catch (error) {
      if (!report.agent_managed || error.code !== "ENOENT") throw error;
      peer = {
        fingerprint: report.host_fingerprint,
        hostname: report.remote_hostname,
        receivedAt: 0,
      };
    }
    if (peer.fingerprint !== report.host_fingerprint)
      throw new Error("Authenticated relay fingerprint changed");
    if (peer.hostname.toLowerCase() !== report.remote_hostname.toLowerCase())
      throw new Error("Relay hostname differs from verified target");
    if (!["win10", "linux"].includes(report.target))
      throw new Error("Unsupported target platform");
    if (
      report.remote_hostname.toLowerCase() === os.hostname().toLowerCase() &&
      !report.cloud_self_test
    )
      throw new Error("Remote identity is this cloud instance");
    result[raw.toLowerCase()] = {
      name: raw.toLowerCase(),
      agentManaged: report.agent_managed === true,
      host: "127.0.0.1",
      port: runtime.port,
      user: "relay",
      keyPath: path.join(folder, "client_key"),
      knownHosts: path.join(folder, "known_hosts"),
      fingerprint: report.host_fingerprint,
      platform: report.target === "win10" ? "windows" : "linux",
      remoteUser: report.remote_user,
      hostname: report.remote_hostname,
      permissions: peer.permissions || null,
      capabilities: peer.capabilities || {},
      relayProtocol: peer.relayProtocol || 1,
      peerReceivedAt: peer.receivedAt,
      group: entry.group || "",
      description: entry.description || "",
      defaultDir: entry.defaultDir || "",
      mode: entry.securityMode || "unrestricted",
      allowPatterns: entry.allowPatterns,
      denyPatterns: entry.denyPatterns,
      folder,
    };
  }
  return result;
}
export function serverConfig(name) {
  const all = servers();
  const resolved = resolveServerName(name, all);
  if (!resolved || !Object.hasOwn(all, resolved))
    throw new Error(`Unknown server ${name}; call ssh_list_servers`);
  return all[resolved];
}
