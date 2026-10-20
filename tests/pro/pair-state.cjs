"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { write, text, folder } = require("../../src/pro/store.cjs");
const { commitPair, recoverPairTransactions } = require("../../src/pro/pair-state.cjs");
const deviceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const info = { deviceId, hostname: "fixture", target: "linux", hostPublicKey: "ssh-ed25519 fixture" };
const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-only\n-----END OPENSSH PRIVATE KEY-----";
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-pair-state-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let registry = {};
  return {
    file: name => path.join(dir, name), targets: new Map(), settings: {},
    safeInfo: value => value, registry: () => structuredClone(registry),
    saveRegistry: value => { registry = structuredClone(value); },
    invalidateTarget() {}, stopWorker() {}, log() {},
  };
}
function staged(agent, transactionId, key = privateKey) {
  const stage = folder(agent.file("pair-staging/" + transactionId));
  write(path.join(stage, "identity.json"), info);
  text(path.join(stage, "client_key"), key);
  write(path.join(stage, "device.json"), { id: deviceId, pairedAt: 1,
    enabled: true, desiredConnected: true });
  write(path.join(stage, "commit.json"), { schemaVersion: 1, transactionId, deviceId });
  return stage;
}
test("committed pairing is recoverable, and completed receipts cannot resurrect an unpaired device", t => {
  const agent = fixture(t), transactionId = crypto.randomUUID();
  const stage = staged(agent, transactionId);
  recoverPairTransactions(agent);
  assert.equal(agent.registry()[deviceId].enabled, true);
  assert.equal(fs.existsSync(stage), false);
  agent.saveRegistry({});
  staged(agent, transactionId);
  recoverPairTransactions(agent);
  assert.deepEqual(agent.registry(), {});
});
test("uncommitted staging is discarded without publishing a device", t => {
  const agent = fixture(t);
  const stage = folder(agent.file("pair-staging/" + crypto.randomUUID()));
  text(path.join(stage, "client_key"), privateKey);
  recoverPairTransactions(agent);
  assert.deepEqual(agent.registry(), {});
  assert.equal(fs.existsSync(stage), false);
});
test("corrupt committed key stops recovery before target identity is published", t => {
  const agent = fixture(t), stage = staged(agent, crypto.randomUUID(), "corrupt");
  assert.throws(() => recoverPairTransactions(agent), /Corrupt committed/);
  assert.deepEqual(agent.registry(), {});
  assert.equal(fs.existsSync(stage), true);
});
test("normal commit saves credentials and a completion receipt", t => {
  const agent = fixture(t);
  commitPair(agent, info, { privateKey });
  assert.equal(agent.registry()[deviceId].desiredConnected, true);
  assert.equal(fs.readFileSync(agent.file("devices/" + deviceId + "/client_key"), "utf8"), privateKey);
  assert.equal(fs.readdirSync(agent.file("pair-completed")).length, 1);
});
