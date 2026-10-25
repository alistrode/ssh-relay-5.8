"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { join } = require("../../src/pro/pairing.cjs");

test("an unanswered handshake reports only timeout, never offline or invalid/expired code", async () => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(join({
      broker: "mqtt://127.0.0.1:" + server.address().port,
      code: "23456789AB-CDEFGHJKLM",
      who: {}, accept: async () => assert.fail("no handshake completed"), timeout: 50,
    }), error => {
      assert.equal(error.code, "PAIRING_TIMEOUT");
      assert.equal(error.phase, "pairing");
      assert.equal(error.message, "Pairing handshake timed out");
      assert.equal(error.retryable, true);
      return true;
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
