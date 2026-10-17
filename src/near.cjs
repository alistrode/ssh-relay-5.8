var fs = require("node:fs");
var path = require("node:path");
var net = require("node:net");
var { createRelay } = require("./relay.cjs");
var { write: writePrivate } = require("./pro/store.cjs");
var { createTraceWriter } = require("./diagnostics.cjs");
var configPath = path.resolve(process.argv[2]);
var config = JSON.parse(fs.readFileSync(configPath, "utf8"));
var recordTrace = createTraceWriter(path.dirname(configPath), "near");
var relay = createRelay(config, "near");
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
  relay.status({ near: true }).catch(() => {});
});
relay.on("peer", (status) => {
  if (status.fingerprint !== config.fingerprint)
    console.error(
      "WARNING: unexpected remote SSH fingerprint; SSH client must reject it.",
    );
  console.log("Authenticated remote status:", JSON.stringify(status));
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
  relay.close();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
