import { loadProfile } from "./profile-loader.js";
import { readState, writeState, stateDir } from "./state.js";
import { spawn } from "node:child_process";
import { run } from "./transport.js";
export function hooks() {
  const defaults = loadProfile().hooks || {};
  const overrides = readState("hooks.json", {});
  return Object.fromEntries(
    Object.entries(defaults).map(([name, h]) => [
      name,
      { ...h, enabled: overrides[name] ?? h.enabled },
    ]),
  );
}
export function toggleHook(name, enabled) {
  if (!Object.hasOwn(hooks(), name)) throw new Error("Unknown hook");
  const settings = readState("hooks.json", {});
  settings[name] = enabled;
  writeState("hooks.json", settings);
  return { name, enabled };
}
export async function executeHook(name, context) {
  const hook = hooks()[name];
  if (!hook?.enabled) return { skipped: true };
  const results = [];
  for (const action of hook.actions || []) {
    if (action.requiresEnv?.some((k) => !process.env[k])) {
      if (action.optional) continue;
      throw new Error("Hook missing required environment bindings");
    }
    // Pass context as environment data or PS/shell-quoted values, never shell-interpolate error messages.
    if (action.remoteCommand) {
      const c = String(action.remoteCommand);
      if (/\{(?:server|error|host|port)\}/.test(c))
        throw new Error(
          "Remote hook placeholders require explicit quoted commands in profile",
        );
      const result = await run(context.server, c, { cwd: context.cwd });
      if (!result.success && !action.optional)
        throw new Error(
          "Remote hook " + action.name + " failed: " + result.stderr,
        );
      results.push(result);
    } else if (action.command) {
      // Historical echo notifications become structured state records, avoiding untrusted shell expansion.
      if (action.type === "notification") {
        const log = readState("hook-events.json", []);
        log.push({
          hook: name,
          action: action.name,
          server: context.server,
          error: context.error || null,
          timestamp: new Date().toISOString(),
        });
        writeState("hook-events.json", log.slice(-1000));
        results.push({ notificationRecorded: true });
        continue;
      }
      if (/\{\w+\}/.test(action.command))
        throw new Error(
          "Local hook placeholders unsupported; use RELAY_HOOK_* environment variables",
        );
      const result = await new Promise((resolve, reject) => {
        const child = spawn(action.command, {
          shell: true,
          cwd: stateDir,
          env: {
            ...process.env,
            RELAY_HOOK_SERVER: context.server || "",
            RELAY_HOOK_ERROR: context.error || "",
          },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Local hook timeout"));
        }, 30000);
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stderr });
        });
      });
      if (result.code !== 0 && !action.optional)
        throw new Error("Hook failed: " + result.stderr);
      results.push(result);
    }
  }
  return { success: true, results };
}
