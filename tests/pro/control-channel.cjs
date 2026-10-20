"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough, Duplex } = require("node:stream");
const { once } = require("node:events");
const { MAX_FRAME, framing, serveControl, ControlClient } = require("../../src/pro/control-channel.cjs");
function pair(t) {
  const a = new PassThrough(), b = new PassThrough();
  const client = Duplex.from({ writable: a, readable: b });
  const server = Duplex.from({ writable: b, readable: a });
  t.after(() => { client.destroy(); server.destroy(); a.destroy(); b.destroy(); });
  return { client, server };
}
test("framing accepts split headers, UTF-8 and coalesced near-limit frames", async () => {
  const stream = new PassThrough(), received = [];
  framing(stream, frame => received.push(frame));
  const value = { text: "汉".repeat(300000) }, body = Buffer.from(JSON.stringify(value));
  const frame = Buffer.alloc(body.length + 4);
  frame.writeUInt32BE(body.length); body.copy(frame, 4);
  stream.write(frame.subarray(0, 2));
  stream.write(Buffer.concat([frame.subarray(2), frame]));
  assert.equal(received.length, 2);
  assert.equal(received[1].text, value.text);
  stream.destroy();
});
test("oversized length and malformed UTF-8 close without dispatch", async () => {
  for (const bytes of [Buffer.from([0, 16, 0, 1]), Buffer.from([0, 0, 0, 2, 0xff, 0xff])]) {
    const stream = new PassThrough();
    let dispatched = false;
    framing(stream, () => { dispatched = true; });
    const closed = once(stream, "close");
    stream.write(bytes);
    await closed;
    assert.equal(dispatched, false);
  }
  assert.equal(MAX_FRAME, 1048576);
});
test("control requests are correlated and preserve structured failures", async t => {
  const streams = pair(t);
  serveControl(streams.server, async (method, params) => {
    if (method === "denied") throw Object.assign(Error("not admitted"), { code: "CONTROL_NOT_ADMITTED" });
    return { protocol: params.protocol };
  });
  const client = new ControlClient(streams.client);
  assert.deepEqual(await client.request("hello", { protocol: 1 }), { protocol: 1 });
  await assert.rejects(client.request("denied"), { code: "CONTROL_NOT_ADMITTED" });
  client.close();
});
test("client request capacity is bounded and channel loss leaves unknown outcomes", async t => {
  const streams = pair(t);
  serveControl(streams.server, () => new Promise(() => {}));
  const client = new ControlClient(streams.client);
  const pending = Array.from({ length: 32 }, () => client.request("get"));
  const settled = Promise.allSettled(pending);
  await assert.rejects(client.request("get"), { code: "CONTROL_CAPACITY" });
  client.close();
  const outcomes = await settled;
  assert.equal(outcomes.every(value => value.status === "rejected" && value.reason.code === "CONTROL_CLOSED"), true);
});
