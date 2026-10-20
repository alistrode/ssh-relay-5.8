"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const root = path.resolve(__dirname, "../..");

test("MCP Agent mode discovers authenticated online targets; legacy report mode remains valid", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-provider-test-"));
  const near = path.join(dir, ".ssh-relay-pro", "near");
  fs.mkdirSync(near, { recursive: true });
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const report = path.join(dir, "connection.json");
  const fingerprint = "SHA256:" + "A".repeat(43);
  save("connection.json", { connected: true, agent_managed: true,
    state_directory: dir, host_fingerprint: fingerprint, target: "linux",
    remote_hostname: "isolated-target", remote_user: "fixture", local_port: 2222 });
  save("runtime.json", { port: 2222 });
  save("peer.json", { fingerprint, hostname: "isolated-target" });
  const token = "c".repeat(64), id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer " + token) {
      res.writeHead(401); res.end('{"error":"Unauthorized"}'); return;
    }
    if (req.url === "/v1/health") {
      res.end(JSON.stringify({ apiVersion: 1, role: "near", profileId: id, bootId: "fixture-boot" }));
      return;
    }
    if (req.url !== "/status") { res.writeHead(404); res.end("{}"); return; }
    calls++;
    const device = { id, enabled: true, state: "online", connectionReport: report };
    res.end(JSON.stringify({ role: "near", settings: { enabled: true },
      devices: [device, { ...device, id: "b".repeat(36), slotPaused: true },
        { ...device, id: "d".repeat(36), state: "retrying" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const runtime = { port: server.address().port, token, role: "near", apiVersion: 1,
    profileId: id, bootId: "fixture-boot" };
  save("agent-runtime.json", runtime);
  save("identity.json", { deviceId: id });
  fs.writeFileSync(path.join(near, "agent-runtime.json"), JSON.stringify(runtime));
  fs.writeFileSync(path.join(near, "identity.json"), JSON.stringify({ deviceId: id }));
  const code = 'const c = await import("./src/mcp/config.js"); await c.refreshAgentServers(); console.log(JSON.stringify(c.servers()));';
  const options = { cwd: root, env: { ...process.env, RELAY_MCP_STATE_DIR: path.join(dir, "mcp") } };
  const agent = await run(process.execPath, ["--input-type=module", "-e", code, "--", "fixture", "--agent-dir", dir], options);
  const found = JSON.parse(agent.stdout);
  assert.deepEqual(Object.keys(found), ["device-" + id]);
  assert.equal(found["device-" + id].fingerprint, fingerprint);
  assert.equal(calls, 1);
  const automatic = await run(process.execPath, ["--input-type=module", "-e", code, "--", "fixture"],
    { ...options, env: { ...options.env, HOME: dir, USERPROFILE: dir } });
  assert.deepEqual(Object.keys(JSON.parse(automatic.stdout)), ["device-" + id]);
  assert.equal(calls, 2);
  const legacy = await run(process.execPath, ["--input-type=module", "-e", code, "--", "fixture", "--connection", report], options);
  assert.equal(JSON.parse(legacy.stdout).remote.fingerprint, fingerprint);
  assert.equal(calls, 2, "legacy mode must not contact Agent");
});
