// MQTT stub deliberately PUBACKs lost frames: this reproduces the broker delivery failure.
const fs = require("node:fs"),
  Module = require("node:module"),
  net = require("node:net"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const path = require("node:path");
const repo = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "src/relay.cjs"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function test(name, filter) {
  const peers = [],
    faults = [];
  let drops = 0;
  const mqtt = {
    connect() {
      const client = new EventEmitter();
      client.subscribe = (topic, options, cb) => {
        client.topic = topic;
        cb();
      };
      client.publish = (topic, payload, options, cb) => {
        const f = JSON.parse(JSON.parse(payload).body);
        const decision = filter(f, drops);
        if (decision === "drop") {
          drops++;
          faults.push({ type: f.type, seq: f.seq });
        } else
          for (const peer of peers)
            if (peer.topic === topic) {
              const deliver = () =>
                peer.emit("message", topic, Buffer.from(payload));
              if (decision === "delay") setTimeout(deliver, 150);
              else setImmediate(deliver);
              if (decision === "duplicate") setTimeout(deliver, 10);
            }
        setImmediate(() => cb?.());
      };
      client.end = () => {
        client.emit("close");
      };
      peers.push(client);
      setImmediate(() => client.emit("connect"));
      return client;
    },
  };
  const module = new Module(path.join(repo, "src/fault-test.cjs"));
  module.filename = path.join(repo, "src/fault-test.cjs");
  module.paths = Module._nodeModulePaths(repo);
  module.require = function (id) {
    if (id === "mqtt") return mqtt;
    return Module.prototype.require.call(this, id);
  };
  module._compile(source, module.filename);
  const echo = net.createServer({ allowHalfOpen: true }, (s) => s.pipe(s));
  await new Promise((r) => echo.listen(0, "127.0.0.1", r));
  const config = {
    session: crypto.randomBytes(16).toString("hex"),
    secret: crypto.randomBytes(32).toString("hex"),
    broker: "test-only",
    sshPort: echo.address().port,
  };
  const far = module.exports.createRelay(config, "far"),
    near = module.exports.createRelay(config, "near");
  far.on("ready", () => far.status({}));
  far.on("peer", () => far.status({}));
  near.on("ready", () => near.status({}));
  near.on("peer", () => {});
  await sleep(400);
  assert.equal(near.snapshot().protocol, 2);
  const nearSockets = [];
  const server = net.createServer({ allowHalfOpen: true }, (s) => {
    nearSockets.push(s);
    near.open(s);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  if (name === "capacity") {
    const sockets = [];
    const echoOne = (socket, text) =>
      new Promise((resolve, reject) => {
        let out = "";
        const onData = (d) => {
          out += d;
          if (out === text) {
            socket.removeListener("data", onData);
            resolve();
          }
        };
        socket.on("data", onData);
        socket.once("error", reject);
        socket.write(text);
      });
    for (let i = 0; i < 8; i++) {
      const s = net.connect(server.address().port, "127.0.0.1");
      await new Promise((resolve) => s.once("connect", resolve));
      await echoOne(s, "slot-" + i);
      sockets.push(s);
    }
    assert.equal(far.snapshot().active, 8);
    const began = Date.now();
    const ninth = net.connect(server.address().port, "127.0.0.1");
    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("Capacity rejection hung")),
        2000,
      );
      ninth.on("close", () => {
        clearTimeout(t);
        resolve();
      });
      ninth.on("error", () => {});
    });
    const rejectMs = Date.now() - began;
    for (let i = 0; i < 8; i++) await echoOne(sockets[i], "still-live-" + i);
    for (const s of sockets) s.end();
    for (
      let k = 0;
      k < 80 &&
      (near.snapshot().active ||
        far.snapshot().active ||
        near.snapshot().pendingFrames ||
        far.snapshot().pendingFrames);
      k++
    )
      await sleep(100);
    assert.equal(near.snapshot().active, 0);
    assert.equal(far.snapshot().active, 0);
    const result = {
      name,
      passed: true,
      rejectMs,
      existingConnectionsPreserved: 8,
      near: near.snapshot(),
      far: far.snapshot(),
    };
    console.log(JSON.stringify(result));
    near.close();
    far.close();
    server.close();
    echo.close();
    return result;
  }
  if (name === "reset-loss" || name === "permanent-data-loss") {
    const sock = net.connect(server.address().port, "127.0.0.1");
    sock.on("error", () => {});
    await new Promise((resolve) => sock.once("connect", resolve));
    if (name === "reset-loss") {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Echo not ready")), 5000);
        sock.once("data", () => {
          clearTimeout(t);
          resolve();
        });
        sock.write("ready");
      });
      nearSockets[0].destroy(new Error("Injected local socket failure"));
    } else sock.write("undeliverable");
    const began = Date.now();
    for (
      let k = 0;
      k < 380 &&
      (near.snapshot().active ||
        far.snapshot().active ||
        near.snapshot().pendingFrames ||
        far.snapshot().pendingFrames ||
        near.snapshot().pendingResets ||
        far.snapshot().pendingResets);
      k++
    )
      await sleep(100);
    assert.equal(near.snapshot().active, 0);
    assert.equal(far.snapshot().active, 0);
    assert.equal(
      near.snapshot().pendingFrames +
        far.snapshot().pendingFrames +
        near.snapshot().pendingResets +
        far.snapshot().pendingResets,
      0,
    );
    if (name === "permanent-data-loss") {
      assert.equal(near.snapshot().deliveryTimeouts, 1);
      assert(Date.now() - began >= 29000);
    }
    if (name === "reset-loss") assert.equal(drops, 4);
    const result = {
      name,
      passed: true,
      drops,
      elapsedMs: Date.now() - began,
      near: near.snapshot(),
      far: far.snapshot(),
    };
    console.log(JSON.stringify(result));
    sock.destroy();
    near.close();
    far.close();
    server.close();
    echo.close();
    return result;
  }
  const payload = crypto.randomBytes(256 * 1024),
    out = [];
  const sock = net.connect(server.address().port, "127.0.0.1");
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(name + " timed out")),
      30000,
    );
    sock.on("connect", () => sock.end(payload));
    sock.on("data", (d) => out.push(d));
    sock.on("error", reject);
    sock.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(out));
    });
  });
  assert.deepEqual(result, payload);
  for (
    let k = 0;
    k < 80 &&
    (near.snapshot().active ||
      far.snapshot().active ||
      near.snapshot().pendingFrames ||
      far.snapshot().pendingFrames);
    k++
  )
    await sleep(100);
  assert.equal(near.snapshot().active, 0);
  assert.equal(far.snapshot().active, 0);
  const summary = {
    name,
    passed: true,
    bytes: payload.length,
    drops,
    near: near.snapshot(),
    far: far.snapshot(),
  };
  console.log(JSON.stringify(summary));
  near.close();
  far.close();
  server.close();
  echo.close();
  sock.destroy();
  return summary;
}
(async () => {
  const results = [];
  results.push(await test("capacity", () => null));
  results.push(await test("clean", () => null));
  results.push(
    await test("drop-opened-and-data", (f, n) =>
      (n === 0 && f.type === "opened") ||
      (n === 1 && f.type === "data" && f.seq === 2)
        ? "drop"
        : null),
  );
  results.push(
    await test("lost-acks", (f, n) =>
      f.type === "ack" && n < 6 ? "drop" : null),
  );
  results.push(
    await test("reorder-duplicates", (f) =>
      f.type === "data" ? (f.seq % 2 ? "delay" : "duplicate") : null),
  );
  results.push(
    await test("reset-loss", (f, n) =>
      ["reset", "reset_ack"].includes(f.type) && n < 4 ? "drop" : null),
  );
  results.push(
    await test("permanent-data-loss", (f) =>
      f.type === "data" ? "drop" : null),
  );
  assert.equal(results.length, 7);
  console.log(
    "PASS: reliable transport fault injection (in-memory MQTT, real TCP)",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
