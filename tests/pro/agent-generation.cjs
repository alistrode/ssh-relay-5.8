"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Agent } = require("../../src/pro/agent.cjs");

test("invalidation clears ownership before synchronous client close", () => {
  const agent = Object.create(Agent.prototype);
  let closed = false;
  const target = { generation: 3, connecting: true, probeBusy: true };
  const client = {
    destroy() {
      assert.equal(target.generation, 4);
      assert.equal(target.client, null);
      assert.equal(target.connecting, false);
      assert.equal(target.probeBusy, false);
      assert.equal(target.probeOwner, null);
      closed = true;
    },
  };
  target.client = client;
  target.probeOwner = client;
  agent.invalidateTarget(target);
  assert.equal(closed, true);
});

test("a late identity result cannot publish a report or clear a replacement probe", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-generation-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "identity.json"), JSON.stringify({
    target: "linux", hostname: "generation-fixture",
  }));
  fs.writeFileSync(path.join(dir, "connection.json"), "previous-report");
  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  const client = {
    exec(command, callback) { callback(null, stream); },
    destroy() {},
  };
  const agent = Object.create(Agent.prototype);
  const target = { id: "fixture", dir, generation: 1, client };
  agent.targets = new Map([[target.id, target]]);
  const pending = agent.identityProbe(target, {});
  agent.invalidateTarget(target);
  const replacement = {};
  target.client = replacement;
  target.probeOwner = replacement;
  target.probeBusy = true;
  stream.emit("data", Buffer.from("user\ngeneration-fixture\n"));
  stream.emit("close", 0);
  await assert.rejects(pending, /Stale identity probe/);
  assert.equal(fs.readFileSync(path.join(dir, "connection.json"), "utf8"), "previous-report");
  assert.equal(target.probeOwner, replacement);
  assert.equal(target.probeBusy, true);
});

test("stopping a worker invalidates an in-flight probe even without a child entry", () => {
  const agent = Object.create(Agent.prototype);
  let destroyed = 0;
  const target = { generation: 7, client: { destroy() { destroyed++; } },
    connecting: true, probeBusy: true };
  agent.targets = new Map([["fixture", target]]);
  agent.children = new Map();
  agent.stopWorker("fixture");
  assert.equal(target.generation, 8);
  assert.equal(target.client, null);
  assert.equal(target.connecting, false);
  assert.equal(destroyed, 1);
});
