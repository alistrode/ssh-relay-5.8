import { resumeUpload } from "./file-transfers.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import { catalog } from "./catalog.js";
import { invoke, handlers } from "./handlers.js";
import { registerPrompts, instructions } from "./prompts.js";
import { closeAll } from "./transport.js";
import { closeSessions } from "./sessions.js";
import { tunnels, closeTunnel } from "./tunnels.js";
import { arg, servers, serverConfig, refreshAgentServers, withServerSnapshot, connectAgent, connectionTask, localAgentClient, agentMode } from "./config.js";
import { TOOL_GROUPS } from "./tool-registry.js";
const server = new McpServer(
  { name: "current-public-relay-mcp", version: "1.1.0" },
  { instructions },
);
const mode = arg("--tools") || "all";
const enabled =
  mode === "all"
    ? new Set(catalog.map((t) => t.name))
    : new Set(
        mode === "minimal"
          ? [
              ...TOOL_GROUPS.core,
              ...TOOL_GROUPS.sessions,
              "ssh_connection_status",
              "ssh_tail",
              "ssh_history",
            ]
          : mode.split(","),
      );
for (const tool of enabled)
  if (!handlers[tool] && !(agentMode && ["ssh_connect", "ssh_operation_status"].includes(tool))) throw new Error("Unknown selected tool " + tool);
const notes = {
  ssh_execute:
    " Runs an independent command. Agent targets advertising persistent task protocol return operationId; query ssh_operation_status after disconnection or an uncertain outcome. Legacy targets return persistent=false. Inspect completed/state and real exit code. More than 2 MiB of inline output requires pagination; sudo, jobs and sessions have separate recovery limits.",
  ssh_sync:
    " Uses portable SFTP with dry-run, exclusion, checksum and delete; no rsync or wire compression. Symlinks are refused.",
  ssh_tail:
    " follow=true returns a bounded five-second observation, not a background tail. follow=false returns a snapshot. Output is returned in the MCP result.",
  ssh_execute_sudo:
    " Linux uses sudo; Windows checks the existing administrator token and never invokes UAC or accepts a sudo password.",
  ssh_backup_create:
    " Explicit paths required for files/full; uses tar on both platforms. Default backup directory is ~/.relay-mcp/backups.",
  ssh_backup_restore:
    " File restore requires explicit non-root targetPath and verifies the manifest checksum. Link-containing archives are refused.",
  ssh_backup_schedule:
    " Numeric cron schedule uses crontab on Linux or a current-user minute task on Windows. No elevation or hidden scheduler installation.",
  ssh_tunnel_create:
    " Only loopback bindings and destinations are supported. Remote must advertise forwarding capability; no LAN or general-purpose proxy.",
  ssh_key_manage:
    " Operates on application pins/revocations only. accept never trusts a changed key; a new verified connection block is required.",
  ssh_session_send:
    " Preserves real shell state on Windows PowerShell and Linux sh without a PTY. Returns the actual exit code, stderr and cwd.",
  ssh_history:
    " Bounded in-memory command metadata; does not persist history across restart.",
  ssh_hooks:
    " Hooks run only when enabled in the selected profile; notifications become structured local events rather than interpolated shell commands.",
  ssh_profile:
    " Profile switch applies immediately to aliases and hooks; presets are platform-specific. No automatic remote configuration.",
  ssh_deploy:
    " Uses staged SFTP replacement; multi-file deployments are not transactional. sudoPassword is not accepted; Unix owner/mode options are not Windows ACLs.",
};
function sanitized(value, args) {
  const secrets = [
    args.password,
    args.code,
    args.dbPassword,
    args.options?.sudoPassword,
  ].filter((s) => typeof s === "string" && s.length);
  const scrub = (v) => {
    if (typeof v === "string") {
      for (const secret of secrets)
        for (const form of new Set([secret, encodeURIComponent(secret)]))
          v = v.split(form).join("[REDACTED]");
      return v;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, scrub(x)]),
      );
    return v;
  };
  return JSON.stringify(scrub(value), null, 2);
}
if (agentMode && (mode === "all" || mode === "minimal" || enabled.has("ssh_connect")))
  server.registerTool("ssh_connect", {
    description: "Pair a device using a code, or connect a remembered server. At most five active devices. Pass connectionTaskId alone to query a pending request. Reuse requestId when retrying the same input.",
    inputSchema: {
      code: z.string().optional(),
      server: z.string().optional(),
      requestId: z.string().uuid().optional(),
      connectionTaskId: z.string().uuid().optional(),
      waitMs: z.number().int().min(0).max(20000).optional(),
    },
  }, async (args) => {
    try {
      const result = await withServerSnapshot(async () => {
        if (args.connectionTaskId) {
          if (args.code !== undefined || args.server !== undefined || args.requestId !== undefined)
            throw Error("Use connectionTaskId alone to query");
          return connectionTask(args.connectionTaskId);
        }
        if ((args.code !== undefined) === (args.server !== undefined))
          throw Error("Provide exactly one of code or server");
        return connectAgent({
          requestId: args.requestId || crypto.randomUUID(),
          ...(args.code !== undefined ? { code: args.code } : { deviceId: serverConfig(args.server).agentDeviceId }),
          waitMs: args.waitMs,
        });
      });
      return { content: [{ type: "text", text: sanitized(result, args) }], isError: result.ok === false };
    } catch (error) {
      return { content: [{ type: "text", text: sanitized({ ok: false, error: {
        code: error.code || "CONNECTION_FAILED", message: error.message,
        retryable: error.retryable === true,
      } }, args) }], isError: true };
    }
  });
if (agentMode && (mode === "all" || mode === "minimal" || enabled.has("ssh_operation_status")))
  server.registerTool("ssh_operation_status", {
    description: "Query an operation by operationId, or a session command by sessionId and requestId. Session query without requestId lists saved requests. Output uses bounded base64 byte pages. action=cancel applies to operations; use ssh_session_close for sessions.",
    inputSchema: {
      operationId: z.string().uuid().optional(),
      transferId: z.string().uuid().optional(),
      resumeTransfer: z.boolean().optional(),
      sessionId: z.string().regex(/^ssh_[a-f0-9-]{36}$/).optional(),
      action: z.enum(["status", "cancel"]).optional(),
      requestId: z.string().uuid().optional(),
      server: z.string().optional(),
      stdoutOffset: z.number().int().min(0).optional(),
      stderrOffset: z.number().int().min(0).optional(),
      limitBytes: z.number().int().min(1).max(65536).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async args => {
    try {
      const result = await withServerSnapshot(async () => {
        if (args.transferId) {
          if (!args.server || args.operationId || args.sessionId || args.action === "cancel") throw Error("Specify server and transferId for transfer status or resume");
          return resumeUpload(args.server, args.transferId, { statusOnly: !args.resumeTransfer });
        }
        const client = await localAgentClient();
        if (args.sessionId) {
          if (args.operationId || args.action === "cancel") throw Error("Use a session query or an operation query separately");
          if (!args.requestId) return { ...(await client.session(args.sessionId)), ...(await client.sessionRequests(args.sessionId)) };
          return client.session(args.sessionId, Object.fromEntries(Object.entries({ requestId: args.requestId,
            stdoutOffset: args.stdoutOffset, stderrOffset: args.stderrOffset, limitBytes: args.limitBytes }).filter(([, value]) => value !== undefined)));
        }
        if (args.action === "cancel") {
          if (!args.operationId) throw Error("operationId is required for cancellation");
          return client.cancelOperation(args.operationId, args.requestId || crypto.randomUUID());
        }
        if (args.operationId) return client.operation(args.operationId,
          Object.fromEntries(Object.entries({ stdoutOffset: args.stdoutOffset,
            stderrOffset: args.stderrOffset, limitBytes: args.limitBytes }).filter(([, value]) => value !== undefined)));
        return client.operations({ limit: args.limit || 20,
          ...(args.server ? { deviceId: serverConfig(args.server).agentDeviceId } : {}) });
      });
      return { content: [{ type: "text", text: sanitized(result, args) }], isError: result.ok === false };
    } catch (error) {
      return { content: [{ type: "text", text: sanitized({ ok: false,
        error: { code: error.code || "OPERATION_QUERY_FAILED", message: error.message } }, args) }], isError: true };
    }
  });
for (const { name, config } of catalog) {
  if (!enabled.has(name)) continue;
  server.registerTool(
    name,
    {
      ...config,
      description: notes[name]
        ? name + ": " + notes[name].trim()
        : config.description,
    },
    async (args) => {
      try {
        const result = await withServerSnapshot(() => invoke(name, args));
        const isError =
          result?.success === false ||
          (result?.code !== undefined && result.code !== 0);
        return {
          content: [{ type: "text", text: sanitized(result, args) }],
          isError,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: sanitized(
                { success: false, error: error.message, tool: name,
                  code: error.code, retryable: error.retryable,
                  transferId: error.transferId, connectionTaskId: error.connectionTaskId, operationId: error.operationId,
                  childOperationId: error.childOperationId, workflowOperationId: error.workflowOperationId, state: error.state, completed: error.completed },
                args,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
registerPrompts(server);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  closeSessions();
  for (const t of [...tunnels.keys()]) await closeTunnel(t).catch(() => {});
  closeAll();
  await server.close();
}
process.once("SIGINT", () => shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => shutdown().finally(() => process.exit(0)));
process.stdin.once("end", () => shutdown());
process.stdin.once("close", () => shutdown());
// Configuration errors fail startup before any tool claims a usable target.
await refreshAgentServers();
servers();
await server.connect(new StdioServerTransport());
console.error(
  `Current public relay MCP ready: ${enabled.size}/37 tools; private application state; fixed host fingerprints`,
);

// Managed profiles remain discoverable while the background repairs their connection.
const { recoverManaged } = await import("./transport.js");
for (const config of Object.values(servers())) recoverManaged(config);

