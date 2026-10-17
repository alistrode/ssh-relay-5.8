// Explicit Linux cloud self-test. All results and credentials belong outside Git.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import net from "node:net";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const root = path.resolve(process.argv[2]),
  connection = path.resolve(process.argv[3]),
  scratch = root + "/operations-" + Date.now();
fs.mkdirSync(scratch, { recursive: true });
fs.writeFileSync(
  scratch + "/payload.txt",
  "真实文件往返\n" + crypto.randomBytes(64).toString("hex"),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  args: [
    fileURLToPath(new URL("../../src/mcp.cjs", import.meta.url)),
    "--connection",
    connection,
    "--name",
    "linux",
    "--state-dir",
    root + "/integration-state",
    "--allow-cloud-self-test",
    "yes",
  ],
  stderr: "pipe",
});
transport.stderr?.on("data", (d) =>
  fs.appendFileSync(root + "/integration.stderr", d),
);
const client = new Client({ name: "actual-mcp-integration", version: "1.0" });
await client.connect(transport);
const checks = [];
async function call(name, args = {}, expect = true) {
  const started = Date.now();
  const response = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 330000,
  });
  const r = JSON.parse(response.content[0].text);
  checks.push({
    name,
    passed: expect ? !response.isError : !!response.isError,
    result: r,
    ms: Date.now() - started,
  });
  fs.writeFileSync(
    root + "/integration-results.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(name, response.isError ? "ERROR" : "OK", Date.now() - started);
  if (expect) assert(!response.isError, JSON.stringify(r));
  else assert(response.isError, JSON.stringify(r));
  return r;
}
const freePort = async () => {
  const s = net.createServer();
  await new Promise((res) => s.listen(0, "127.0.0.1", res));
  const port = s.address().port;
  await new Promise((res) => s.close(res));
  return port;
};
const echo = net.createServer((s) => s.pipe(s));
await new Promise((res) => echo.listen(0, "127.0.0.1", res));
const echoProbe = (port) =>
  new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    let out = "";
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error("Forwarded echo timeout"));
    }, 15000);
    s.on("connect", () => s.write("forwarded-real-data"));
    s.on("data", (d) => {
      out += d;
      if (out === "forwarded-real-data") {
        clearTimeout(timer);
        s.destroy();
        resolve();
      }
    });
    s.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
try {
  assert.equal((await client.listTools()).tools.length, 37);
  assert.equal((await client.listPrompts()).prompts.length, 5);
  await client.getPrompt({
    name: "remote-connect",
    arguments: { server: "linux", task: "identity probe" },
  });
  await client.readResource({ uri: "relay-mcp://guide" });
  await call("ssh_list_servers");
  await call(
    "ssh_execute",
    {
      server: "linux",
      command:
        'printf "stdout-marker\\n"; printf "stderr-marker\\n" >&2; exit 7',
    },
    false,
  );
  await call("ssh_upload", {
    server: "linux",
    localPath: scratch + "/payload.txt",
    remotePath: scratch + "/remote.txt",
  });
  await call("ssh_download", {
    server: "linux",
    remotePath: scratch + "/remote.txt",
    localPath: scratch + "/downloaded.txt",
  });
  assert.equal(
    fs.readFileSync(scratch + "/payload.txt", "utf8"),
    fs.readFileSync(scratch + "/downloaded.txt", "utf8"),
  );
  fs.mkdirSync(scratch + "/tree/sub", { recursive: true });
  fs.writeFileSync(scratch + "/tree/sub/a.txt", "sync-a");
  fs.writeFileSync(scratch + "/tree/excluded.txt", "excluded");
  await call("ssh_sync", {
    server: "linux",
    source: "local:" + scratch + "/tree",
    destination: "remote:" + scratch + "/remote-tree",
    exclude: ["excluded.txt"],
    dryRun: true,
  });
  assert(!fs.existsSync(scratch + "/remote-tree"));
  await call("ssh_sync", {
    server: "linux",
    source: "local:" + scratch + "/tree",
    destination: "remote:" + scratch + "/remote-tree",
    exclude: ["excluded.txt"],
    checksum: true,
  });
  assert.equal(
    fs.readFileSync(scratch + "/remote-tree/sub/a.txt", "utf8"),
    "sync-a",
  );
  assert(!fs.existsSync(scratch + "/remote-tree/excluded.txt"));
  fs.writeFileSync(scratch + "/remote-tree/extra.txt", "delete");
  await call("ssh_sync", {
    server: "linux",
    source: "local:" + scratch + "/tree",
    destination: "remote:" + scratch + "/remote-tree",
    exclude: ["excluded.txt"],
    delete: true,
  });
  assert(!fs.existsSync(scratch + "/remote-tree/extra.txt"));
  const session = await call("ssh_session_start", {
    server: "linux",
    name: "state-preservation",
  });
  await call("ssh_session_send", {
    session: session.id,
    command: "cd " + scratch + "; export RELAY_PROBE='persisted'",
  });
  const state = await call("ssh_session_send", {
    session: session.id,
    command: 'printf "%s\\n" "$RELAY_PROBE"; pwd',
  });
  assert.equal(state.stdout, "persisted\n" + scratch);
  assert.equal(state.cwd, scratch);
  await call(
    "ssh_session_send",
    { session: session.id, command: "false" },
    false,
  );
  await call("ssh_session_list");
  await call("ssh_session_close", { session: session.id });
  await call("ssh_health_check", { server: "linux" });
  await call("ssh_monitor", { server: "linux", type: "memory" });
  await call("ssh_process_manager", {
    server: "linux",
    action: "info",
    pid: process.pid,
  });
  await call(
    "ssh_service_status",
    { server: "linux", services: ["relay-nonexistent-service"] },
    false,
  );
  await call("ssh_tail", {
    server: "linux",
    file: scratch + "/payload.txt",
    follow: false,
    lines: 1,
  });
  await call("ssh_alert_setup", { server: "linux", action: "get" });
  await call("ssh_alert_setup", { server: "linux", action: "check" });
  const backup = await call("ssh_backup_create", {
    server: "linux",
    type: "files",
    name: "integration",
    paths: [scratch + "/tree"],
    backupDir: scratch + "/backups",
  });
  await call("ssh_backup_list", {
    server: "linux",
    backupDir: scratch + "/backups",
  });
  await call("ssh_backup_restore", {
    server: "linux",
    backupId: backup.backup.id,
    backupDir: scratch + "/backups",
    targetPath: scratch + "/restored",
  });
  assert.equal(
    fs.readFileSync(scratch + "/restored/tree/sub/a.txt", "utf8"),
    "sync-a",
  );
  await call(
    "ssh_backup_schedule",
    {
      server: "linux",
      type: "files",
      name: "invalid_schedule",
      schedule: "invalid",
      paths: [scratch + "/tree"],
    },
    false,
  );
  for (const action of ["dump", "import", "list", "query"])
    await call(
      "ssh_db_" + action,
      {
        server: "linux",
        type: "postgresql",
        database: "relay_test_missing",
        ...(action === "dump"
          ? { outputFile: scratch + "/db.sql" }
          : action === "import"
            ? { inputFile: scratch + "/missing.sql" }
            : action === "query"
              ? { query: "SELECT 1" }
              : {}),
      },
      false,
    );
  await call("ssh_deploy", {
    server: "linux",
    files: [
      { local: scratch + "/payload.txt", remote: scratch + "/remote.txt" },
    ],
    options: { backup: true, permissions: "600" },
  });
  await call("ssh_execute_sudo", { server: "linux", command: "true" }, false);
  await call("ssh_alias", {
    action: "add",
    alias: "testalias",
    server: "linux",
  });
  await call("ssh_execute", {
    server: "testalias",
    command: "printf alias-ok",
  });
  await call("ssh_alias", { action: "remove", alias: "testalias" });
  await call("ssh_command_alias", {
    action: "add",
    alias: "probe-command",
    command: "printf command-alias-ok",
  });
  const ca = await call("ssh_execute", {
    server: "linux",
    command: "probe-command",
  });
  assert.equal(ca.stdout, "command-alias-ok");
  await call("ssh_command_alias", { action: "remove", alias: "probe-command" });
  await call("ssh_hooks", { action: "list" });
  await call("ssh_hooks", { action: "disable", hook: "on-error" });
  await call("ssh_profile", { action: "switch", profile: "windows" });
  await call("ssh_profile", { action: "switch", profile: "default" });
  await call("ssh_group_manage", {
    action: "create",
    name: "probe",
    servers: ["linux"],
  });
  await call("ssh_execute_group", {
    group: "probe",
    command: "printf group-ok",
    strategy: "rolling",
    delay: 0,
  });
  await call("ssh_group_manage", { action: "delete", name: "probe" });
  await call("ssh_key_manage", { server: "linux", action: "verify" });
  await call("ssh_key_manage", { server: "linux", action: "list" });
  await call("ssh_history");
  for (const type of ["local", "remote"]) {
    const port = await freePort();
    const t = await call("ssh_tunnel_create", {
      server: "linux",
      type,
      localPort: type === "local" ? port : echo.address().port,
      remoteHost: "127.0.0.1",
      remotePort: type === "local" ? echo.address().port : port,
    });
    await echoProbe(port);
    await call("ssh_tunnel_list");
    await call("ssh_tunnel_close", { tunnelId: t.id });
  }
  await call("ssh_connection_status", { action: "status" });
  await call("ssh_connection_status", {
    action: "disconnect",
    server: "linux",
  });
  console.log(
    "INTEGRATION PASS",
    checks.length,
    "calls;",
    new Set(checks.map((c) => c.name)).size,
    "tool names",
  );
} finally {
  echo.close();
  await client.close();
}
