"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { request } = require("../../src/pro/agent-client.cjs");

test("shared client authenticates on loopback and reloads rotated runtime tokens", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-api-test-"));
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer " + token) {
      res.writeHead(401); res.end(JSON.stringify({ error: "Unauthorized" })); return;
    }
    res.end(JSON.stringify({ role: "near", devices: [] }));
  });
  let token = "a".repeat(64);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const save = (value) => fs.writeFileSync(path.join(dir, "agent-runtime.json"),
    JSON.stringify({ port: server.address().port, token: value }));
  save(token);
  assert.equal((await request(dir, "/status")).role, "near");
  token = "b".repeat(64);
  await assert.rejects(request(dir, "/status"), /Unauthorized/);
  save(token);
  assert.equal((await request(dir, "/status")).role, "near");
  save("invalid");
  await assert.rejects(request(dir, "/status"), /Invalid local Agent endpoint/);
});
