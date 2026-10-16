"use strict";
// Explicit cloud self-test. Private credentials and raw logs stay outside Git.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { ensure, request } = require("../../src/pro/cli.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  root = path.resolve(
    process.argv[2] || "/tmp/relay-pro-recovery-" + Date.now(),
  ),
  near = root + "/near",
  far = root + "/far",
  checks = [];
let mcp, transport;
const record = (name, details = {}) => {
  checks.push({ name, passed: true, ...details });
  fs.writeFileSync(
    root + "/recovery-results.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(JSON.stringify(checks.at(-1)));
};
async function online(after = 0) {
  for (let n = 0; n < 120; n++) {
    const s = await request(near, "/status").catch(() => null),
      d = s?.devices[0];
    if (d?.state === "online" && d.lastVerifiedAt > after) return d;
    await sleep(1000);
  }
  throw Error("Automatic recovery deadline exceeded");
}
async function killOwned(pid) {
  const cmd = fs.readFileSync("/proc/" + pid + "/cmdline").toString();
  assert(cmd.includes(root), "Refusing to signal an unrelated process");
  process.kill(pid, "SIGKILL");
  await sleep(500);
}
async function tool(name, args = {}) {
  const response = await mcp.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  return { error: !!response.isError, ...JSON.parse(response.content[0].text) };
}
async function mcpRecovered() {
  for (let i = 0; i < 120; i++) {
    const state = await tool("ssh_connection_status", { action: "status" });
    if (JSON.stringify(state).includes('"connected":true')) return;
    await sleep(1000);
  }
  throw Error("MCP did not automatically recover without replaying a command");
}
(async () => {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  await ensure({
    dir: far,
    role: "far",
    allowCloudSelfTest: true,
    testHooks: true,
  });
  await ensure({
    dir: near,
    role: "near",
    allowCloudSelfTest: true,
    testHooks: true,
  });
  try {
    const p = await request(far, "/pair/create", {});
    await request(near, "/pair/connect", { code: p.code });
    let d = await online();
    const initial = JSON.parse(fs.readFileSync(d.connectionReport));
    record("public_pairing_and_pinned_identity", {
      deviceId: d.id,
      protocol: 2,
    });
    const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      ),
      { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      );
    transport = new StdioClientTransport({
      command: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      args: [
        path.resolve(__dirname, "../../src/mcp.cjs"),
        "--connection",
        d.connectionReport,
        "--name",
        "test",
        "--allow-cloud-self-test",
        "yes",
        "--state-dir",
        root + "/mcp",
      ],
      stderr: "pipe",
    });
    transport.stderr.on("data", (x) =>
      fs.appendFileSync(root + "/mcp-private.log", x),
    );
    mcp = new Client({ name: "pro-recovery-test", version: "1" });
    await mcp.connect(transport);
    assert.equal((await mcp.listTools()).tools.length, 37);
    assert.equal((await mcp.listPrompts()).prompts.length, 5);
    let value = await tool("ssh_execute", {
      server: "test",
      command: "printf pro-mcp-ok",
    });
    assert.equal(value.stdout, "pro-mcp-ok");
    record("mcp_37_tools_5_prompts_and_real_command");
    const counter = root + "/command-counter";
    const executing = tool("ssh_execute", {
      server: "test",
      command:
        "printf x >> '" + counter + "'; sleep 60; printf should-not-finish",
      timeout: 90000,
    }).catch((e) => ({ error: true, message: e.message }));
    for (let i = 0; i < 100 && !fs.existsSync(counter); i++) await sleep(200);
    assert(fs.existsSync(counter));
    let at = Date.now();
    await request(near, "/test/drop-network", {});
    await online(at);
    const interrupted = await executing;
    assert(
      interrupted.error ||
        interrupted.success === false ||
        interrupted.code !== 0,
    );
    assert.equal(fs.readFileSync(counter, "utf8"), "x");
    record("network_drop_auto_recovers_without_command_replay", {
      seconds: (Date.now() - at) / 1000,
    });
    await mcpRecovered();
    record("mcp_pool_reconnected_without_execute_replay");
    d = await online();
    at = Date.now();
    await killOwned(d.workerPid);
    d = await online(at);
    await mcpRecovered();
    record("near_worker_crash_auto_recovers", {
      seconds: (Date.now() - at) / 1000,
      mcpAutomaticallyRecovered: true,
    });
    let runtime = JSON.parse(fs.readFileSync(near + "/agent-runtime.json"));
    at = Date.now();
    await killOwned(runtime.pid);
    d = await online(at);
    await mcpRecovered();
    record("near_agent_restart_remembers_target_and_key", {
      seconds: (Date.now() - at) / 1000,
      mcpAutomaticallyRecovered: true,
    });
    runtime = JSON.parse(fs.readFileSync(far + "/agent-runtime.json"));
    at = Date.now();
    await killOwned(runtime.pid);
    d = await online(at);
    await mcpRecovered();
    assert.equal(
      JSON.parse(fs.readFileSync(d.connectionReport)).host_fingerprint,
      initial.host_fingerprint,
    );
    record("far_agent_restart_preserves_ssh_identity", {
      seconds: (Date.now() - at) / 1000,
      mcpAutomaticallyRecovered: true,
    });
    at = Date.now();
    await request(far, "/test/drop-network", {});
    d = await online(at);
    await mcpRecovered();
    record("far_network_drop_auto_recovers", {
      seconds: (Date.now() - at) / 1000,
      mcpAutomaticallyRecovered: true,
    });
    const before = (await request(far, "/status")).devices.length;
    const wrong = await request(far, "/pair/create", {});
    const code =
      wrong.code.slice(0, -1) + (wrong.code.endsWith("A") ? "B" : "A");
    let denied = false;
    try {
      await request(near, "/pair/connect", { code });
    } catch {
      denied = true;
    }
    assert(denied);
    assert.equal((await request(far, "/status")).devices.length, before);
    await request(far, "/pair/cancel", {});
    record("wrong_pair_code_cannot_authorize_a_device");
    const nearId = (await request(near, "/status")).deviceId;
    await request(far, "/unpair", { id: nearId });
    for (let i = 0; i < 90; i++) {
      const state = (await request(near, "/status")).devices[0]?.state;
      if (state === "identity_error") break;
      if (i === 89) throw Error("Revocation not enforced");
      await sleep(1000);
    }
    record("revoked_authorization_is_not_silently_repaired");
    const fresh = await request(far, "/pair/create", {});
    await request(near, "/pair/connect", { code: fresh.code });
    await online();
    record("explicit_repair_after_revocation");
    fs.writeFileSync(
      root + "/completed.json",
      JSON.stringify(
        { passed: true, cloudSelfTest: true, checks: checks.length, root },
        null,
        2,
      ),
    );
    console.log("PUBLIC RECOVERY PASS", checks.length);
  } finally {
    await mcp?.close().catch(() => {});
    for (const dir of [near, far])
      await request(dir, "/shutdown", {}).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
