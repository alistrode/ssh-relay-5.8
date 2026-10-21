import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const require = createRequire(import.meta.url), { Server, utils } = require("ssh2");
const { keyPair } = require("../../src/pro/keys.cjs"), { serveSftp } = require("../../src/sftp.cjs"), { attachForwarding } = require("../../src/forwarding.cjs");
test("all original MCP entry points execute isolated operations or report capability errors through legacy SSH", { timeout: 60000, skip: process.platform !== "linux" }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-mcp-legacy-e2e-"));
  const host = keyPair(), credential = keyPair(), key = utils.parseKey(credential.privateKey), peers = new Set(), children = new Set();
  const home = path.join(root, "remote-home"); fs.mkdirSync(home);
  const server = new Server({ hostKeys: [host.privateKey] });
  server.on("connection", peer => {
    peers.add(peer); peer.on("error", () => {}); peer.on("close", () => peers.delete(peer));
    peer.on("authentication", ctx => {
      if (ctx.method === "publickey" && ctx.key.data.equals(key.getPublicSSH()) && (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) ctx.accept(); else ctx.reject();
    });
    peer.on("ready", () => {
      attachForwarding(peer);
      peer.on("session", accept => {
        const session = accept();
        session.on("sftp", acceptSftp => serveSftp(acceptSftp()));
        const shell = (acceptChannel, command) => {
          const channel = acceptChannel(), child = spawn("/bin/sh", command === undefined ? ["-s"] : ["-c", command],
            { cwd: root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: root, LANG: "C.UTF-8" }, stdio: "pipe" });
          children.add(child); child.stdin.on("error", () => {}); channel.on("error", () => {});
          channel.pipe(child.stdin); child.stdout.pipe(channel, { end: false }); child.stderr.pipe(channel.stderr, { end: false });
          child.once("close", code => { children.delete(child); channel.exit(code ?? 1); channel.end(); });
          channel.once("close", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
        };
        session.on("exec", (acceptChannel, _reject, info) => shell(acceptChannel, info.command));
        session.on("shell", acceptChannel => shell(acceptChannel));
      });
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const state = path.join(root, "connection"); fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, "client_key"), credential.privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(state, "runtime.json"), JSON.stringify({ port: server.address().port }));
  fs.writeFileSync(path.join(state, "peer.json"), JSON.stringify({ fingerprint: host.fingerprint, hostname: os.hostname(), capabilities: { forwarding: "loopback-only", nodeExecutable: process.execPath, nodeMode: process.versions.electron ? "electron" : "node" }, relayProtocol: 2, receivedAt: Date.now() }));
  const report = path.join(root, "connection.json");
  fs.writeFileSync(report, JSON.stringify({ connected: true, state_directory: state, host_fingerprint: host.fingerprint,
    remote_hostname: os.hostname(), remote_user: os.userInfo().username, target: "linux", cloud_self_test: true }));
  const client = new McpClient({ name: "legacy-real-ssh-check", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, env: { PATH: process.env.PATH, HOME: root, ELECTRON_RUN_AS_NODE: "1" }, args: [path.resolve("src/mcp.cjs"), "--connection", report,
    "--name", "linux", "--state-dir", path.join(root, "mcp-state"), "--allow-cloud-self-test", "yes"], stderr: "pipe" });
  const calls = [], capabilityErrors = [];
  const auxiliary = [], auxiliarySockets = new Set();
  t.after(async () => {
    await client.close().catch(() => {}); for (const peer of peers) peer.end(); for (const child of children) child.kill("SIGTERM");
    for (const socket of auxiliarySockets) socket.destroy();
    await Promise.all(auxiliary.map(listener => new Promise(resolve => listener.close(resolve))));
    await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  });
  await client.connect(transport);
  const call = async (name, args = {}, expectError = false) => {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
    const value = JSON.parse(response.content[0].text); calls.push(name);
    if (response.isError) capabilityErrors.push(name);
    if (expectError !== null) assert.equal(!!response.isError, expectError, name + ": " + JSON.stringify(value));
    return value;
  };
  await call("ssh_list_servers");
  const execution = await call("ssh_execute", { server: "linux", command: "printf stdout-marker; printf stderr-marker >&2; exit 7" }, true);
  assert.equal(execution.stdout, "stdout-marker"); assert.equal(execution.stderr, "stderr-marker"); assert.equal(execution.code, 7);
  const source = path.join(root, "source"), remote = path.join(root, "remote"), downloaded = path.join(root, "downloaded");
  fs.writeFileSync(source, "真实 MCP 字节往返\n" + crypto.randomBytes(64).toString("hex"));
  await call("ssh_upload", { server: "linux", localPath: source, remotePath: remote });
  await call("ssh_download", { server: "linux", remotePath: remote, localPath: downloaded });
  assert.deepEqual(fs.readFileSync(source), fs.readFileSync(downloaded));
  const session = await call("ssh_session_start", { server: "linux", name: "fixture" });
  await call("ssh_session_send", { session: session.id, command: "cd '" + root + "'; export RELAY_CHECK_VALUE=retained" });
  const retained = await call("ssh_session_send", { session: session.id, command: "printf '%s' \"$RELAY_CHECK_VALUE\"" });
  assert.equal(retained.stdout, "retained"); assert.equal(retained.cwd, root);
  await call("ssh_session_list"); await call("ssh_session_close", { session: session.id });
  await call("ssh_alias", { action: "add", alias: "fixture-alias", server: "linux" });
  assert.equal((await call("ssh_execute", { server: "fixture-alias", command: "printf alias-ok" })).stdout, "alias-ok");
  await call("ssh_alias", { action: "remove", alias: "fixture-alias" });
  const tree = path.join(root, "tree"), targetTree = path.join(root, "target-tree"); fs.mkdirSync(tree); fs.writeFileSync(path.join(tree, "entry"), "sync-value");
  await call("ssh_sync", { server: "linux", source: "local:" + tree, destination: "remote:" + targetTree, dryRun: true });
  assert.equal(fs.existsSync(targetTree), false);
  await call("ssh_sync", { server: "linux", source: "local:" + tree, destination: "remote:" + targetTree, checksum: true });
  assert.equal(fs.readFileSync(path.join(targetTree, "entry"), "utf8"), "sync-value");
  const backupDir = path.join(root, "backups");
  const backup = await call("ssh_backup_create", { server: "linux", type: "files", name: "fixture", paths: [tree], backupDir });
  await call("ssh_backup_list", { server: "linux", backupDir });
  await call("ssh_backup_restore", { server: "linux", backupId: backup.backup.id, backupDir, targetPath: path.join(root, "restored") });
  assert.equal(fs.readFileSync(path.join(root, "restored/tree/entry"), "utf8"), "sync-value");
  await call("ssh_deploy", { server: "linux", files: [{ local: source, remote }], options: { backup: true, permissions: "600" } });
  assert.deepEqual(fs.readFileSync(remote), fs.readFileSync(source)); assert.equal(fs.statSync(remote).mode & 0o777, 0o600);
  await call("ssh_tail", { server: "linux", file: source, follow: false, lines: 1 });
  await call("ssh_history"); await call("ssh_connection_status", { action: "status" });
  await call("ssh_command_alias", { action: "add", alias: "fixture-command", command: "printf command-alias-ok" });
  assert.equal((await call("ssh_execute", { server: "linux", command: "fixture-command" })).stdout, "command-alias-ok");
  await call("ssh_command_alias", { action: "remove", alias: "fixture-command" });
  await call("ssh_hooks", { action: "list" }); await call("ssh_profile", { action: "list" });
  await call("ssh_group_manage", { action: "create", name: "fixture-group", servers: ["linux"] });
  await call("ssh_execute_group", { group: "fixture-group", command: "printf group-ok", strategy: "rolling", delay: 0 });
  await call("ssh_group_manage", { action: "delete", name: "fixture-group" });
  await call("ssh_key_manage", { server: "linux", action: "verify" });
  await call("ssh_health_check", { server: "linux" }); await call("ssh_monitor", { server: "linux", type: "memory" });
  const diagnosticPid = Number(fs.readFileSync("/proc/self/stat", "utf8").split(" ")[0]);
  // Restricted /proc environments can make the native ps command unavailable.
  await call("ssh_process_manager", { server: "linux", action: "info", pid: diagnosticPid }, null);
  const serviceStatus = await call("ssh_service_status", { server: "linux", services: ["relay-fixture-nonexistent-service"] }, null);
  assert.equal(serviceStatus.services?.[0]?.name, "relay-fixture-nonexistent-service");
  await call("ssh_alert_setup", { server: "linux", action: "get" }); await call("ssh_alert_setup", { server: "linux", action: "check" });
  await call("ssh_backup_schedule", { server: "linux", type: "files", name: "fixture", schedule: "invalid", paths: [tree] }, true);
  const notDatabase = net.createServer(socket => { auxiliarySockets.add(socket); socket.on("close", () => auxiliarySockets.delete(socket)); socket.on("error", () => {}); socket.end(); });
  await new Promise(resolve => notDatabase.listen(0, "127.0.0.1", resolve)); auxiliary.push(notDatabase);
  for (const action of ["dump", "import", "list", "query"]) await call("ssh_db_" + action, {
    server: "linux", type: "postgresql", dbHost: "127.0.0.1", dbPort: notDatabase.address().port, database: "relay_fixture_missing",
    ...(action === "dump" ? { outputFile: path.join(root, "db.sql") } : action === "import" ? { inputFile: path.join(root, "missing.sql") } : action === "query" ? { query: "SELECT 1" } : {}),
  }, true);
  await call("ssh_execute_sudo", { server: "linux", command: "true" }, null);
  const echo = net.createServer(socket => { auxiliarySockets.add(socket); socket.on("close", () => auxiliarySockets.delete(socket)); socket.on("error", () => {}); socket.pipe(socket); });
  await new Promise(resolve => echo.listen(0, "127.0.0.1", resolve)); auxiliary.push(echo);
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const tunnel = await call("ssh_tunnel_create", { server: "linux", type: "local", localPort: port, remoteHost: "127.0.0.1", remotePort: echo.address().port });
  await new Promise((resolve, reject) => { const socket = net.connect(port, "127.0.0.1"), timer = setTimeout(() => { socket.destroy(); reject(Error("Forwarded echo timed out")); }, 3000);
    socket.once("connect", () => socket.write("mcp-tunnel")); socket.once("data", bytes => { clearTimeout(timer); socket.destroy(); try { assert.equal(bytes.toString(), "mcp-tunnel"); resolve(); } catch (e) { reject(e); } }); socket.once("error", e => { clearTimeout(timer); reject(e); }); });
  await call("ssh_tunnel_list"); await call("ssh_tunnel_close", { tunnelId: tunnel.id });
  await call("ssh_connection_status", { server: "linux", action: "disconnect" });
  assert.equal(new Set(calls).size, 37);
  console.log(JSON.stringify({ scope: "isolated legacy report MCP over actual loopback SSH", calls: calls.length,
    originalToolNames: new Set(calls).size, errorPathTools: [...new Set(capabilityErrors)] }));
});
