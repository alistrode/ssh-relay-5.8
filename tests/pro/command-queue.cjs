"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const queue = import("../../src/mcp/command-queue.js");
function connection() { return { verified: true, connected: true, client: new EventEmitter() }; }
test("a third command waits while another device and identity probe remain independent", async () => {
  const { withCommandSlot } = await queue;
  const first = connection(), other = connection(), started = [], completions = [];
  const work = label => () => new Promise(resolve => { started.push(label); completions.push(resolve); });
  const jobs = ["one", "two", "three"].map(label => withCommandSlot(first, 1000, work(label)));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["one", "two"]);
  assert.equal(await withCommandSlot(other, 1000, async () => "other"), "other");
  assert.equal(await withCommandSlot({ verified: false }, 1000, async () => "probe"), "probe");
  completions[0]("first");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["one", "two", "three"]);
  completions[1]("second"); completions[2]("third");
  assert.deepEqual(await Promise.all(jobs), ["first", "second", "third"]);
});
test("queue timeout never invokes work; close rejects queued work", async () => {
  const { withCommandSlot } = await queue;
  const conn = connection(), finish = [];
  const held = [0, 1].map(() => withCommandSlot(conn, 1000, () => new Promise(resolve => finish.push(resolve))));
  await new Promise(resolve => setImmediate(resolve));
  let executed = false;
  await assert.rejects(withCommandSlot(conn, 10, async () => { executed = true; }),
    { code: "COMMAND_QUEUE_TIMEOUT" });
  assert.equal(executed, false);
  const waiting = withCommandSlot(conn, 1000, async () => { executed = true; });
  const rejection = assert.rejects(waiting, { code: "CONNECTION_CLOSED" });
  conn.connected = false;
  conn.client.emit("close");
  await rejection;
  finish.forEach(resolve => resolve());
  await Promise.all(held);
  assert.equal(executed, false);
});
