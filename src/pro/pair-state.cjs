"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { folder, read, write, text, id } = require("./store.cjs");
function plainFile(file, limit = 65536) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw Error("Invalid private pairing transaction");
  return fs.readFileSync(file, "utf8");
}
function apply(agent, stage) {
  if (fs.lstatSync(stage).isSymbolicLink()) throw Error("Invalid pairing staging directory");
  const commit = JSON.parse(plainFile(path.join(stage, "commit.json")));
  if (commit.schemaVersion !== 1 || id(commit.transactionId) !== path.basename(stage))
    throw Error("Invalid pairing commit identity");
  const receipt = agent.file("pair-completed/" + commit.transactionId + ".json");
  const completed = read(receipt, null);
  if (completed) {
    if (completed.deviceId !== commit.deviceId) throw Error("Invalid pairing completion receipt");
    fs.rmSync(stage, { recursive: true });
    return;
  }
  const info = agent.safeInfo(JSON.parse(plainFile(path.join(stage, "identity.json"))));
  const device = JSON.parse(plainFile(path.join(stage, "device.json")));
  const key = plainFile(path.join(stage, "client_key"));
  if (id(commit.deviceId) !== info.deviceId ||
      device.id !== info.deviceId || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key) ||
      typeof device.pairedAt !== "number" || !Number.isFinite(device.pairedAt))
    throw Error("Corrupt committed pairing transaction; recovery stopped");
  const registry = agent.registry();
  // No async boundary while credentials and registry are installed. A crash
  // leaves the committed stage for the next locked Agent startup to complete.
  const target = agent.targets.get(info.deviceId);
  if (target) {
    agent.invalidateTarget(target);
    target.state = "waiting";
    target.failures = 0;
    target.nextAt = 0;
  }
  agent.stopWorker(info.deviceId);
  const destination = folder(agent.file("devices/" + info.deviceId));
  text(path.join(destination, "client_key"), key);
  text(path.join(destination, "known_hosts"), "relay-" + info.deviceId + " " + info.hostPublicKey + "\n");
  write(path.join(destination, "identity.json"), info);
  // An already-applied transaction must not undo a later explicit disconnect.
  registry[info.deviceId] = registry[info.deviceId]?.pairTransactionId === commit.transactionId
    ? registry[info.deviceId] : { ...device, pairTransactionId: commit.transactionId };
  agent.saveRegistry(registry);
  agent.settings.defaultDevice = info.deviceId;
  write(agent.file("settings.json"), agent.settings);
  // The receipt survives partial stage cleanup and prevents a completed pairing
  // from being replayed after a later disconnect or unpair.
  write(receipt, { deviceId: info.deviceId, appliedAt: Date.now() });
  fs.rmSync(stage, { recursive: true });
}
function commitPair(agent, info, keys) {
  const transactionId = crypto.randomUUID();
  const stage = folder(agent.file("pair-staging/" + transactionId));
  write(path.join(stage, "identity.json"), info);
  text(path.join(stage, "client_key"), keys.privateKey);
  write(path.join(stage, "device.json"), {
    id: info.deviceId, label: info.label || info.hostname, hostname: info.hostname,
    target: info.target, enabled: true, desiredConnected: true,
    schemaVersion: 1, autoConnect: true,
    pairedAt: agent.registry()[info.deviceId]?.pairedAt || Date.now(),
  });
  // Commit marker is written last. No target files are changed before it exists.
  write(path.join(stage, "commit.json"), { schemaVersion: 1, transactionId, deviceId: info.deviceId });
  apply(agent, stage);
}
function recoverPairTransactions(agent) {
  const directory = agent.file("pair-staging");
  let names;
  try { names = fs.readdirSync(directory); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const name of names) {
    if (!/^[a-f0-9-]{36}$/.test(name)) throw Error("Invalid pairing staging entry");
    const stage = path.join(directory, name);
    const stat = fs.lstatSync(stage);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Invalid pairing staging directory");
    if (!fs.existsSync(path.join(stage, "commit.json"))) {
      fs.rmSync(stage, { recursive: true });
      agent.log("pair_uncommitted_discarded");
    } else {
      apply(agent, stage);
      agent.log("pair_transaction_recovered");
    }
  }
}
module.exports = { commitPair, recoverPairTransactions };
