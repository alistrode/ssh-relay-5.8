import { AsyncLocalStorage } from "node:async_hooks";
import { resolveServerName } from "./server-aliases.js";
import { agentServers, readyAgentServer, agentClient, createAgentDiscovery } from "./agent-provider.js";
const args = process.argv.slice(2);
export function arg(name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
}
const agentDir = arg("--agent-dir");
if (process.argv.some(value => value === "--connection" || value === "--connections"))
  throw Error("5.7 refuses connection blocks and manifests from other branches; use that branch's own client");
if (args.includes("--agent-dir") && (!agentDir || agentDir.startsWith("--"))) throw Error("--agent-dir requires a 5.7 state path");
const allowCloudSelfTest = arg("--allow-cloud-self-test") === "yes";
const context = new AsyncLocalStorage();
const discovery = createAgentDiscovery(() => agentServers(agentDir, allowCloudSelfTest));
export async function withServerSnapshot(fn) {
  const snapshot = await agentServers(agentDir, allowCloudSelfTest);
  return context.run({ servers: Object.freeze(snapshot) }, fn);
}
export async function prepareServer(name) {
  const base = serverConfig(name);
  return readyAgentServer(agentDir, base, allowCloudSelfTest);
}
export async function connectAgent(input) {
  return (await agentClient(agentDir)).connect(input);
}
export async function connectionTask(key) {
  return (await agentClient(agentDir)).connectionTask(key);
}
export async function localAgentClient() {
  return agentClient(agentDir);
}
export async function setAgentConnection(config, connected) {
  const client = await agentClient(agentDir);
  const requestId = (await import("node:crypto")).randomUUID();
  if (!connected) return client.disconnect(config.agentDeviceId, requestId);
  const task = await client.connect({ requestId, deviceId: config.agentDeviceId, waitMs: 20000 });
  if (task.state !== "ready") {
    const error = Error(task.error?.message || "Device connection is " + task.state);
    error.code = task.error?.code || "DEVICE_NOT_READY";
    error.connectionTaskId = task.connectionTaskId;
    throw error;
  }
  return task;
}
export async function refreshAgentServers() {
  // Clear stale descriptors before awaiting: API failure must not leave a
  // disabled or unpaired target available through the old snapshot.
  await discovery.refresh();
}
export function servers() {
  return context.getStore()?.servers || discovery.snapshot();
}
export function serverConfig(name) {
  const all = servers();
  const resolved = resolveServerName(name, all);
  if (!resolved || !Object.hasOwn(all, resolved))
    throw new Error(`Unknown server ${name}; call ssh_list_servers`);
  return all[resolved];
}

