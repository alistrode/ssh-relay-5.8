import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export const stateDir = path.resolve(
  process.env.RELAY_MCP_STATE_DIR ||
    path.join(os.homedir(), ".local", "state", "current-relay-mcp"),
);
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
export const statePath = (name) => path.join(stateDir, name);
export function readState(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(statePath(name), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export function writeState(name, value) {
  const p = statePath(name);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}
