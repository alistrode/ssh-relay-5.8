"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), net = require("node:net"), crypto = require("node:crypto");
const { pathToFileURL } = require("node:url"), { Server, Client, utils } = require("ssh2");
const { keyPair } = require("../../src/pro/keys.cjs"), { attachForwarding } = require("../../src/forwarding.cjs");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("real SSH tunnel recreates a listener for the same device and explicit close cancels restoration", { timeout: 30000, skip: typeof vm.SourceTextModule !== "function" }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-tunnel-recovery-")), host = keyPair(), credential = keyPair();
  const key = utils.parseKey(credential.privateKey), peers = new Set(), clients = new Set(), sockets = new Set();
  const server = new Server({ hostKeys: [host.privateKey] }); let module, connections = 0, live;
  server.on("connection", peer => {
    peers.add(peer); peer.on("close", () => peers.delete(peer)); peer.on("error", () => {});
    peer.on("authentication", ctx => {
      if (ctx.method === "publickey" && ctx.key.data.equals(key.getPublicSSH()) && (!ctx.signature || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) ctx.accept(); else ctx.reject();
    });
    peer.on("ready", () => attachForwarding(peer));
  });
  const echo = net.createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); socket.pipe(socket); });
  await new Promise(resolve => echo.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (module) for (const id of [...module.namespace.tunnels.keys()]) await module.namespace.closeTunnel(id).catch(() => {});
    for (const client of clients) client.destroy(); for (const peer of peers) peer.end(); for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => echo.close(resolve)), new Promise(resolve => server.close(resolve))]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const deviceId = crypto.randomUUID(), config = { name: "test", agentDeviceId: deviceId, capabilities: { forwarding: "loopback-only" } };
  const connect = async () => {
    if (!live || live._sock?.destroyed) {
      live = new Client(); clients.add(live); live.on("close", () => clients.delete(live));
      await new Promise((resolve, reject) => { live.once("ready", resolve); live.once("error", reject); live.connect({ host: "127.0.0.1", port: server.address().port, username: "test", privateKey: credential.privateKey,
        hostVerifier: data => "SHA256:" + crypto.createHash("sha256").update(data).digest("base64").replace(/=+$/, "") === host.fingerprint }); });
      connections++;
    }
    return { client: live, config };
  };
  const context = vm.createContext({ Buffer, console, setTimeout, clearTimeout });
  const synthetic = (exports, identifier) => new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context, identifier });
  const file = path.resolve(__dirname, "../../src/mcp/tunnels.js");
  module = new vm.SourceTextModule(fs.readFileSync(file, "utf8"), { context, identifier: pathToFileURL(file).href, initializeImportMeta: meta => { meta.url = pathToFileURL(file).href; } });
  await module.link(spec => {
    if (spec === "node:net") return synthetic({ default: net }, spec);
    if (spec === "node:fs") return synthetic({ default: fs }, spec);
    if (spec === "node:crypto") return synthetic({ randomUUID: crypto.randomUUID }, spec);
    if (spec === "node:module") return synthetic({ createRequire: require("node:module").createRequire }, spec);
    if (spec === "./state.js") return synthetic({ statePath: name => path.join(dir, name) }, spec);
    if (spec === "./config.js") return synthetic({ servers: () => ({ test: config }) }, spec);
    if (spec === "./transport.js") return synthetic({ connect }, spec);
    throw Error("Unexpected tunnel dependency");
  });
  await module.evaluate();
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const localPort = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const tunnel = await module.namespace.createTunnel({ server: "test", type: "local", localPort, remoteHost: "127.0.0.1", remotePort: echo.address().port });
  const probe = value => new Promise((resolve, reject) => {
    const socket = net.connect(localPort, "127.0.0.1"), timer = setTimeout(() => { socket.destroy(); reject(Error("Tunnel echo timed out")); }, 3000);
    socket.once("connect", () => socket.write(value));
    socket.once("data", bytes => { clearTimeout(timer); socket.destroy(); resolve(bytes.toString()); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  assert.equal(await probe("before"), "before"); live.destroy();
  const waitActive = async expectedConnections => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && (connections < expectedConnections || module.namespace.tunnels.get(tunnel.id)?.state !== "active")) await delay(100);
    assert.ok(connections >= expectedConnections); assert.equal(module.namespace.tunnels.get(tunnel.id)?.state, "active");
  };
  await waitActive(2); assert.equal(await probe("after"), "after");
  await module.namespace.closeTunnel(tunnel.id, { remember: true }); module.namespace.restoreTunnels();
  await waitActive(2); assert.equal(await probe("restored"), "restored");
  await module.namespace.closeTunnel(tunnel.id); module.namespace.restoreTunnels();
  assert.equal(module.namespace.tunnels.has(tunnel.id), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "tunnel-records", tunnel.id + ".json"))).desired, false);
});
