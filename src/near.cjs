if (require.main === module) throw Error("5.5 不支持独立后台入口，请启动 SSH Relay Pro 客户端");
var fs = require("node:fs");
var path = require("node:path");
var net = require("node:net");
var crypto = require("node:crypto");
var { probe } = require("./pro/admission.cjs");
var { createRelay } = require("./relay.cjs");
var { write: writePrivate } = require("./pro/store.cjs");
var { createTraceWriter } = require("./diagnostics.cjs");
var configPath = path.resolve(process.argv[2]);
var config = JSON.parse(fs.readFileSync(configPath, "utf8"));
var recordTrace = createTraceWriter(path.dirname(configPath), "near");
var relay = createRelay(config, "near");
var requestId = crypto.randomUUID(), remoteChallenge;
function announce() {
  const controllerProbe = config.controllerId && config.controllerKeyPath && remoteChallenge
    ? probe(fs.readFileSync(config.controllerKeyPath), config.controllerId, requestId, remoteChallenge) : undefined;
  relay.status({ near:true, controllerProbe }).catch(() => {});
}
process.on("message", message => {
  if (message?.type === "request-control") { requestId = crypto.randomUUID(); announce(); }
});
var heartbeat = setInterval(announce, 15000);
var server = net.createServer({ allowHalfOpen: true }, (socket) =>
  relay.open(socket),
);
server.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
server.listen(config.localPort, "127.0.0.1", () => {
  const port = server.address().port;
  if (config.runtimePath)
    writePrivate(config.runtimePath, { pid: process.pid, port });
  console.log("Near-end loopback listener: " + port);
});
relay.on("ready", () => {
  console.log("Near-end public relay subscribed.");
  announce();
});
relay.on("peer", (status) => {
  if (status.fingerprint !== config.fingerprint)
    console.error(
      "WARNING: unexpected remote SSH fingerprint; SSH client must reject it.",
    );
  console.log("Authenticated remote status:", JSON.stringify(status));
  if (status.fingerprint === config.fingerprint && /^[a-f0-9]{32}$/.test(status.admission?.challenge || "") && remoteChallenge !== status.admission.challenge) {
    remoteChallenge = status.admission.challenge; announce();
  }
  if (config.statusPath && status.fingerprint === config.fingerprint) {
    writePrivate(config.statusPath, { ...status, receivedAt: Date.now() });
  }
});
relay.on("offline", () =>
  console.log("Public relay disconnected; reconnecting."),
);
relay.on("diagnostic", (message) => console.error("Relay:", message));
relay.on("trace", (entry) => {
  recordTrace(entry);
  console.error("RELAY_TRACE " + JSON.stringify(entry));
});
function close() {
  clearInterval(heartbeat);
  relay.close();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
