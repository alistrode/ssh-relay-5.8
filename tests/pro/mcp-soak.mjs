import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = process.argv[2],
  repo = path.resolve(import.meta.dirname, "../.."),
  transport = new StdioClientTransport({
    command: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    args: [
      repo + "/src/mcp.cjs",
      "--connection",
      root + "/connection.json",
      "--name",
      "soak",
      "--allow-cloud-self-test",
      "yes",
      "--state-dir",
      root + "/mcp-state",
    ],
    stderr: "pipe",
  });
transport.stderr.on("data", (d) =>
  fs.appendFileSync(root + "/mcp-private.log", d),
);
const client = new Client({ name: "pro-hour-soak", version: "1" }),
  results = [];
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 37);
  assert.equal((await client.listPrompts()).prompts.length, 5);
  let i = 0;
  while (!fs.existsSync(root + "/stop-mcp")) {
    const started = Date.now(),
      nonce = crypto.randomBytes(10).toString("hex");
    try {
      const response = await client.callTool(
          {
            name: "ssh_execute",
            arguments: { server: "soak", command: "printf " + nonce },
          },
          undefined,
          { timeout: 120000 },
        ),
        result = JSON.parse(response.content[0].text);
      assert(!response.isError);
      assert.equal(result.stdout, nonce);
      assert.equal(result.code, 0);
      if (i % 3 === 0) {
        const h = await client.callTool(
          { name: "ssh_health_check", arguments: { server: "soak" } },
          undefined,
          { timeout: 120000 },
        );
        assert(!h.isError);
      }
      results.push({
        passed: true,
        cycle: i,
        ms: Date.now() - started,
        time: new Date().toISOString(),
      });
    } catch (e) {
      results.push({ passed: false, cycle: i, error: e.message });
      throw e;
    } finally {
      fs.writeFileSync(
        root + "/mcp-soak-results.json",
        JSON.stringify(results, null, 2),
      );
    }
    i++;
    const until = Date.now() + 30000;
    while (Date.now() < until && !fs.existsSync(root + "/stop-mcp"))
      await new Promise((r) => setTimeout(r, 500));
  }
} finally {
  await client.close();
}
