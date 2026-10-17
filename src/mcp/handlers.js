import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { servers, serverConfig } from "./config.js";
import { connect, run, pool, sftp, sftpCall, psQuote } from "./transport.js";
import { upload, download, sync, remotePath } from "./files.js";
import { job } from "./jobs.js";
import {
  sessions,
  startSession,
  sendSession,
  sessionInfo,
  closeSession,
} from "./sessions.js";
import { tunnels, createTunnel, tunnelInfo, closeTunnel } from "./tunnels.js";
import { shellQuote } from "./shell-quote.js";
import { evaluatePolicy } from "./policy.js";
import * as alias from "./server-aliases.js";
import * as commandAlias from "./command-aliases.js";
import * as profiles from "./profile-loader.js";
import * as groups from "./server-groups.js";
import { hooks, toggleHook, executeHook } from "./hooks.js";
import { readState, writeState } from "./state.js";
import { logger } from "./logger.js";
groups.setServerConfigProvider(servers);
const need = (a, key) => {
  if (a[key] === undefined || a[key] === "")
    throw new Error(key + " is required");
  return a[key];
};
const bounded = (value, def, min, max) => {
  const n = value ?? def;
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Expected integer ${min}..${max}`);
  return n;
};
const checked = (r) => {
  if (r.success === false || (r.code !== undefined && r.code !== 0))
    throw new Error(
      r.stderr || r.error || "Remote operation failed with exit code " + r.code,
    );
  return r;
};
function policy(server, tool, command) {
  const config = serverConfig(server);
  const p = evaluatePolicy(config, tool, command);
  if (!p.allowed) throw new Error(p.reason);
  return config;
}
async function execute(a, sudo = false) {
  const command = commandAlias.expandCommandAlias(need(a, "command"));
  const config = policy(
    a.server,
    sudo ? "ssh_execute_sudo" : "ssh_execute",
    command,
  );
  const timeout = bounded(a.timeout, 120000, 1, 300000);
  const start = Date.now();
  let result;
  try {
    if (/\bbench\s+update\b/.test(command))
      await executeHook("pre-bench-update", {
        server: a.server,
        cwd: a.cwd || config.defaultDir,
      });
    if (sudo && config.platform === "windows") {
      if (a.password)
        throw new Error(
          "Windows uses the existing remote token; sudo passwords are not accepted",
        );
      const guard =
        "if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Remote is not elevated; launch remote from an authorized Administrator terminal'};";
      result = await run(a.server, guard + command, {
        cwd: a.cwd || config.defaultDir,
        timeout,
      });
    } else if (sudo) {
      const stripped = command.replace(/^sudo\s+/, "");
      result = await run(
        a.server,
        a.password
          ? `sudo -S -k -p '' sh -c ${shellQuote(stripped)}`
          : `sudo -n sh -c ${shellQuote(stripped)}`,
        {
          cwd: a.cwd || config.defaultDir,
          timeout,
          stdin: a.password ? a.password + "\n" : null,
        },
      );
    } else
      result = await run(a.server, command, {
        cwd: a.cwd || config.defaultDir,
        timeout,
      });
    if (result.success && /\bbench\s+update\b/.test(command))
      await executeHook("post-bench-update", {
        server: a.server,
        cwd: a.cwd || config.defaultDir,
      });
    logger.record({
      server: config.name,
      command,
      duration: Date.now() - start,
      success: result.success,
      code: result.code,
    });
    return {
      server: config.name,
      hostname: config.hostname,
      remoteUser: config.remoteUser,
      ...result,
    };
  } catch (e) {
    logger.record({
      server: config.name,
      command,
      duration: Date.now() - start,
      success: false,
      error: e.message,
    });
    throw e;
  }
}
async function health(a) {
  if (a.interval !== undefined) bounded(a.interval, 2, 1, 60);
  if (a.duration !== undefined) bounded(a.duration, 1, 1, 240);
  return job(
    a.server,
    "health",
    { duration: a.duration, interval: a.interval },
    a.duration ? Math.min(300000, (a.duration + 30) * 1000) : 30000,
  );
}
async function backupCreate(a) {
  if (["files", "full"].includes(a.type))
    return job(a.server, "backup", { ...a, action: "create" }, 300000);
  return job(a.server, "database", { ...a, action: "backup" }, 300000);
}
async function backupRestore(a) {
  const verified = checked(
    await job(a.server, "backup", {
      action: "verify",
      backupId: a.backupId,
      backupDir: a.backupDir,
    }),
  );
  const meta = verified.backup;
  if (["files", "full"].includes(meta.type))
    return job(a.server, "backup", { ...a, action: "restore" }, 300000);
  return job(
    a.server,
    "database",
    {
      ...a,
      type: meta.type,
      database: a.database || meta.database,
      inputFile: meta.file,
      action: "import",
    },
    300000,
  );
}

async function schedule(a) {
  const source = fs.readFileSync(
    new URL(
      "./jobs/" +
        (["files", "full"].includes(a.type) ? "backup" : "database") +
        ".cjs",
      import.meta.url,
    ),
    "utf8",
  );
  const script = `(async()=>{const module={exports:null};(function(module){${source}\n})(module);return module.exports(${JSON.stringify({ ...a, action: ["files", "full"].includes(a.type) ? "create" : "backup" })});})().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  return job(
    a.server,
    "schedule",
    { name: a.name, schedule: a.schedule, script },
    60000,
  );
}
async function serviceStatus(a) {
  const c = serverConfig(a.server);
  if (!a.services.length) throw new Error("services must not be empty");
  if (c.platform === "windows") {
    const script = `$names=@(${a.services.map(psQuote).join(",")});$r=@(foreach($n in $names){try{$s=Get-Service -Name $n -ErrorAction Stop;[pscustomobject]@{name=$s.Name;status=$s.Status.ToString();success=$true}}catch{[pscustomobject]@{name=$n;success=$false;error=$_.Exception.Message}}});ConvertTo-Json -InputObject $r -Compress`;
    const r = await run(a.server, script);
    return r.success
      ? {
          success: JSON.parse(r.stdout).every((s) => s.success),
          services: JSON.parse(r.stdout),
          code: r.code,
        }
      : r;
  }
  const results = [];
  for (const name of a.services) {
    const r = await run(
      a.server,
      `systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState -- ${shellQuote(name)}`,
      { timeout: 15000 },
    );
    results.push({ name, ...r });
  }
  return { success: results.every((r) => r.success), services: results };
}
async function processManager(a) {
  const c = serverConfig(a.server);
  let command;
  if (a.action === "list") {
    const limit = bounded(a.limit, 20, 1, 1000);
    command =
      c.platform === "windows"
        ? `Get-Process | Sort-Object ${a.sortBy === "memory" ? "WorkingSet64" : "CPU"} -Descending | ${a.filter ? `Where-Object {$_.ProcessName -like ${psQuote("*" + a.filter + "*")}} | ` : ""}Select-Object -First ${limit} Id,ProcessName,CPU,WorkingSet64,Path | ConvertTo-Json -Compress`
        : `ps -eo pid,ppid,user,pcpu,pmem,rss,args --sort=-${a.sortBy === "memory" ? "rss" : "pcpu"} | ${a.filter ? "grep -F -- " + shellQuote(a.filter) + " | " : ""}head -n ${limit + 1}`;
  } else {
    const pid = bounded(a.pid, undefined, 2, 2147483647);
    if (a.action === "info")
      command =
        c.platform === "windows"
          ? `Get-Process -Id ${pid} | Select-Object Id,ProcessName,CPU,WorkingSet64,Path,StartTime | ConvertTo-Json -Compress`
          : `ps -p ${pid} -o pid,ppid,user,pcpu,pmem,rss,lstart,args`;
    else {
      if (
        c.platform === "windows" &&
        a.signal &&
        !["TERM", "KILL"].includes(a.signal)
      )
        throw new Error(
          "Windows supports TERM/KILL via Stop-Process; POSIX HUP/INT/QUIT are not available",
        );
      command =
        c.platform === "windows"
          ? `Stop-Process -Id ${pid} ${a.signal === "KILL" ? "-Force" : ""} -ErrorAction Stop;Write-Output 'Process stopped'`
          : `kill -s ${a.signal || "TERM"} -- ${pid}`;
    }
  }
  return run(a.server, command, { timeout: 30000 });
}
async function deploy(a) {
  const config = serverConfig(a.server);
  if (
    config.platform === "windows" &&
    (a.options?.owner || a.options?.permissions)
  )
    throw new Error(
      "Unix owner/mode options do not apply to Windows ACLs; use explicit authorized PowerShell via ssh_execute",
    );
  if (a.options?.permissions && !/^[0-7]{3,4}$/.test(a.options.permissions))
    throw new Error("Invalid Unix permissions");
  if (
    a.options?.owner &&
    !/^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)?$/.test(a.options.owner)
  )
    throw new Error("Invalid Unix owner");
  if (a.options?.sudoPassword)
    throw new Error(
      "Deployment uses inherited remote permissions; use ssh_execute_sudo explicitly for privileged staging",
    );
  await executeHook("pre-deploy", { server: a.server });
  const s = await sftp(a.server),
    results = [];
  for (const file of a.files) {
    const dest = await remotePath(a.server, file.remote),
      tmp = dest + ".relay-upload-" + crypto.randomBytes(6).toString("hex");
    let backup = null;
    try {
      await upload({
        server: a.server,
        localPath: file.local,
        remotePath: tmp,
      });
      let exists;
      try {
        exists = await sftpCall(s, "lstat", dest);
      } catch (e) {
        if (e.code !== 2) throw e;
      }
      if (exists?.isSymbolicLink() || exists?.isDirectory())
        throw new Error("Deployment target must be a regular file");
      if (exists && a.options?.backup !== false) {
        backup = dest + ".bak-" + Date.now();
        await sftpCall(s, "rename", dest, backup);
      }
      try {
        await sftpCall(s, "rename", tmp, dest);
      } catch (e) {
        if (backup) await sftpCall(s, "rename", backup, dest);
        throw e;
      }
      if (a.options?.permissions)
        checked(
          await run(
            a.server,
            `chmod ${a.options.permissions} -- ${shellQuote(dest)}`,
          ),
        );
      if (a.options?.owner)
        checked(
          await run(
            a.server,
            `chown ${shellQuote(a.options.owner)} -- ${shellQuote(dest)}`,
          ),
        );
      results.push({ local: file.local, remote: dest, backup, success: true });
    } catch (e) {
      try {
        await sftpCall(s, "unlink", tmp);
      } catch {}
      throw new Error(
        "Deployment failed for " +
          dest +
          ": " +
          e.message +
          "; prior completed files may already be deployed",
      );
    }
  }
  if (a.options?.restart)
    checked(
      await run(
        a.server,
        config.platform === "windows"
          ? `Restart-Service -Name ${psQuote(a.options.restart)} -ErrorAction Stop`
          : `systemctl restart -- ${shellQuote(a.options.restart)}`,
      ),
    );
  await executeHook("post-deploy", { server: a.server });
  return { success: true, files: results };
}
async function keyManage(a) {
  const all = servers(),
    revoked = readState("revoked-keys.json", {});
  if (a.action === "list")
    return {
      success: true,
      hosts: Object.values(all).map((c) => ({
        server: c.name,
        hostname: c.hostname,
        fingerprint: c.fingerprint,
        revoked: !!revoked[c.name],
      })),
    };
  const c = serverConfig(need(a, "server"));
  if (a.action === "remove") {
    pool.get(c.name)?.close();
    revoked[c.name] = c.fingerprint;
    writeState("revoked-keys.json", revoked);
    return { success: true, server: c.name, revoked: true };
  }
  if (a.action === "accept") {
    delete revoked[c.name];
    writeState("revoked-keys.json", revoked);
  }
  await connect(c.name);
  return {
    success: true,
    server: c.name,
    verified: true,
    fingerprint: c.fingerprint,
    source:
      "pinned connection report; changed host keys require a newly verified connection block",
  };
}
export const handlers = {
  ssh_list_servers: async () => ({
    success: true,
    servers: Object.values(servers()).map((c) => ({
      name: c.name,
      hostname: c.hostname,
      remoteUser: c.remoteUser,
      platform: c.platform,
      group: c.group,
      description: c.description,
      defaultDir: c.defaultDir,
      permissions: c.permissions,
      capabilities: c.capabilities,
      relayProtocol: c.relayProtocol,
      peerStatusAgeMs: Date.now() - c.peerReceivedAt,
    })),
  }),
  ssh_execute: (a) => execute(a),
  ssh_execute_sudo: (a) => execute(a, true),
  ssh_upload: upload,
  ssh_download: download,
  ssh_sync: sync,
  ssh_session_start: (a) => startSession(a.server, a.name),
  ssh_session_send: async (a) => {
    const s = sessions.get(a.session);
    if (!s) throw new Error("Unknown session");
    const cmd = commandAlias.expandCommandAlias(a.command);
    policy(s.server, "ssh_session_send", cmd);
    const r = await sendSession(a.session, cmd, a.timeout);
    logger.record({
      server: s.server,
      command: cmd,
      success: r.success,
      code: r.code,
    });
    return r;
  },
  ssh_session_list: async (a) => ({
    success: true,
    sessions: [...sessions.values()]
      .filter((s) => !a.server || s.server.includes(a.server.toLowerCase()))
      .map(sessionInfo),
  }),
  ssh_session_close: async (a) => ({
    success: true,
    closed:
      a.session === "all"
        ? [...sessions.keys()].map(closeSession)
        : [closeSession(a.session)],
  }),
  ssh_health_check: health,
  ssh_service_status: serviceStatus,
  ssh_process_manager: processManager,
  ssh_monitor: async (a) => {
    if (a.type === "process") return processManager({ ...a, action: "list" });
    const r = await health(a);
    if (!r.success) return r;
    if (a.type && a.type !== "overview") {
      r.samples = r.samples.map((s) =>
        a.type === "cpu"
          ? { cpuPercent: s.cpuPercent, timestamp: s.timestamp }
          : a.type === "memory"
            ? { memory: s.memory, timestamp: s.timestamp }
            : a.type === "disk"
              ? { disk: s.disk, timestamp: s.timestamp }
              : { network: s.network, timestamp: s.timestamp },
      );
    }
    return r;
  },
  ssh_tail: (a) => job(a.server, "tail", a, 20000),
  ssh_alert_setup: async (a) => {
    const r = await job(a.server, "alerts", a);
    if (a.action !== "check" || !r.success) return r;
    const h = checked(await health(a)).samples[0];
    const alerts = [];
    if (r.config.enabled) {
      if (h.cpuPercent > r.config.cpuThreshold)
        alerts.push({ metric: "cpu", value: h.cpuPercent });
      if (h.memory.usedPercent > r.config.memoryThreshold)
        alerts.push({ metric: "memory", value: h.memory.usedPercent });
      for (const d of h.disk)
        if (d.usedPercent > r.config.diskThreshold)
          alerts.push({ metric: "disk", path: d.path, value: d.usedPercent });
    }
    return { ...r, alerts, metrics: h };
  },
  ssh_backup_create: backupCreate,
  ssh_backup_list: (a) => job(a.server, "backup", { ...a, action: "list" }),
  ssh_backup_restore: backupRestore,
  ssh_backup_schedule: schedule,
  ssh_db_dump: (a) =>
    job(a.server, "database", { ...a, action: "dump" }, 300000),
  ssh_db_import: (a) =>
    job(a.server, "database", { ...a, action: "import" }, 300000),
  ssh_db_list: (a) =>
    job(a.server, "database", { ...a, action: "list" }, 300000),
  ssh_db_query: (a) =>
    job(a.server, "database", { ...a, action: "query" }, 300000),
  ssh_deploy: deploy,
  ssh_alias: async (a) => {
    if (a.action === "list")
      return { success: true, aliases: alias.listAliases() };
    const name = need(a, "alias").toLowerCase();
    if (
      !/^[a-zA-Z0-9_-]+$/.test(name) ||
      ["__proto__", "prototype", "constructor"].includes(name)
    )
      throw new Error("Invalid alias");
    const ok =
      a.action === "add"
        ? alias.addAlias(name, serverConfig(need(a, "server")).name)
        : alias.removeAlias(name);
    if (!ok) throw new Error("Failed saving alias");
    return { success: true, aliases: alias.listAliases() };
  },
  ssh_command_alias: async (a) => {
    if (a.action === "list")
      return { success: true, aliases: commandAlias.listCommandAliases() };
    if (a.action === "suggest")
      return {
        success: true,
        suggestions: commandAlias.suggestAliases(a.command || ""),
      };
    const name = need(a, "alias");
    if (
      !/^[a-zA-Z0-9_-]+$/.test(name) ||
      ["__proto__", "prototype", "constructor"].includes(name)
    )
      throw new Error("Invalid command alias");
    const ok =
      a.action === "add"
        ? commandAlias.addCommandAlias(name, need(a, "command"))
        : commandAlias.removeCommandAlias(name);
    if (!ok) throw new Error("Failed saving command alias");
    return { success: true, aliases: commandAlias.listCommandAliases() };
  },
  ssh_hooks: async (a) =>
    a.action === "enable" || a.action === "disable"
      ? { success: true, ...toggleHook(need(a, "hook"), a.action === "enable") }
      : { success: true, hooks: hooks() },
  ssh_profile: async (a) => {
    if (a.action === "list")
      return { success: true, profiles: profiles.listProfiles() };
    if (a.action === "switch" && !profiles.setActiveProfile(need(a, "profile")))
      throw new Error("Profile switch failed");
    return {
      success: true,
      active: profiles.getActiveProfileName(),
      profile: profiles.loadProfile(),
    };
  },
  ssh_connection_status: async (a) => {
    if (["disconnect", "reconnect"].includes(a.action)) {
      const c = serverConfig(need(a, "server"));
      for (const s of [...sessions.values()])
        if (s.server === c.name) closeSession(s.id);
      for (const t of [...tunnels.values()])
        if (t.server === c.name) await closeTunnel(t.id);
      pool.get(c.name)?.close();
      if (a.action === "reconnect") await connect(c.name);
    }
    if (a.action === "cleanup") {
      for (const s of [...sessions.values()])
        if (s.state === "closed" || Date.now() - s.lastActivity > 1800000)
          closeSession(s.id);
    }
    return {
      success: true,
      connections: Object.values(servers()).map((c) => ({
        server: c.name,
        hostname: c.hostname,
        connected: !!pool.get(c.name)?.connected,
        permissions: c.permissions,
        relayProtocol: c.relayProtocol,
        peerStatusAgeMs: Date.now() - c.peerReceivedAt,
      })),
    };
  },
  ssh_tunnel_create: createTunnel,
  ssh_tunnel_list: async (a) => ({
    success: true,
    tunnels: [...tunnels.values()]
      .filter((t) => !a.server || t.server === serverConfig(a.server).name)
      .map(tunnelInfo),
  }),
  ssh_tunnel_close: async (a) => {
    if (!a.tunnelId && !a.server)
      throw new Error("tunnelId or server required");
    return {
      success: true,
      closed: a.tunnelId
        ? [await closeTunnel(a.tunnelId)]
        : await Promise.all(
            [...tunnels.values()]
              .filter((t) => t.server === serverConfig(a.server).name)
              .map((t) => closeTunnel(t.id)),
          ),
    };
  },
  ssh_key_manage: keyManage,
  ssh_group_manage: async (a) => {
    if (a.action === "list")
      return { success: true, groups: groups.listGroups() };
    const n = need(a, "name");
    if (
      !/^[a-zA-Z0-9_-]+$/.test(n) ||
      ["__proto__", "constructor", "prototype"].includes(n)
    )
      throw new Error("Invalid group name");
    if (a.servers) for (const s of a.servers) serverConfig(s);
    let result;
    switch (a.action) {
      case "create":
        result = groups.createGroup(n, a.servers || [], a);
        break;
      case "update":
        result = groups.updateGroup(n, a);
        break;
      case "delete":
        result = groups.deleteGroup(n);
        break;
      case "add-servers":
        result = groups.addServersToGroup(n, need(a, "servers"));
        break;
      case "remove-servers":
        result = groups.removeServersFromGroup(n, need(a, "servers"));
        break;
    }
    return { success: true, result };
  },
  ssh_execute_group: async (a) => {
    const group = groups.getGroup(a.group);
    if (!group) throw new Error("Unknown group");
    const strategy = a.strategy || group.strategy || "parallel";
    const results = [];
    const call = async (name) => {
      try {
        return {
          server: name,
          ...(await execute({ server: name, command: a.command, cwd: a.cwd })),
        };
      } catch (e) {
        return { server: name, success: false, error: e.message };
      }
    };
    if (strategy === "parallel")
      results.push(...(await Promise.all(group.servers.map(call))));
    else
      for (const name of group.servers) {
        const r = await call(name);
        results.push(r);
        if (!r.success && (a.stopOnError ?? group.stopOnError)) break;
        if (strategy === "rolling")
          await new Promise((res) =>
            setTimeout(res, bounded(a.delay ?? group.delay, 1000, 0, 30000)),
          );
      }
    return { success: results.every((r) => r.success), strategy, results };
  },
  ssh_history: async (a) => ({
    success: true,
    history: logger
      .getHistory(1000)
      .filter(
        (h) =>
          (!a.server || h.server === a.server) &&
          (!a.search || h.command.includes(a.search)) &&
          (a.success === undefined || h.success === a.success),
      )
      .slice(-bounded(a.limit, 20, 1, 1000)),
  }),
};
export async function invoke(name, args) {
  let server = args.server;
  if (name === "ssh_session_send") server = sessions.get(args.session)?.server;
  // Apply policies centrally to every remote operation; command-bearing handlers evaluate expanded aliases again.
  if (server) {
    const config = serverConfig(server);
    const readAction =
      (name === "ssh_process_manager" && args.action !== "kill") ||
      (name === "ssh_alert_setup" && args.action !== "set") ||
      (name === "ssh_key_manage" &&
        ["list", "verify", "check"].includes(args.action));
    if (!readAction)
      policy(
        server,
        name,
        typeof args.command === "string"
          ? commandAlias.expandCommandAlias(args.command)
          : undefined,
      );
    if (
      readState("revoked-keys.json", {})[config.name] &&
      name !== "ssh_key_manage"
    )
      throw new Error(
        "Pinned key revoked for this application; explicitly accept the verified connection report to reconnect",
      );
  }
  const fn = handlers[name];
  if (!fn) throw new Error("Tool not implemented");
  try {
    const result = await fn(args);
    if (result?.success === false)
      await executeHook("on-error", {
        server,
        error: "Tool " + name + " failed",
      }).catch(() => {});
    return result;
  } catch (error) {
    await executeHook("on-error", {
      server,
      error: "Tool " + name + " failed",
    }).catch(() => {});
    throw error;
  }
}
