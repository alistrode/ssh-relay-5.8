"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { normalizeSessionRequest } = require("../../src/pro/session-spec.cjs");
test("session command identity binds the session, sequence and normalized input", () => {
  const input = { sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), sequence: 1, spec: { command: "echo ok" } };
  const first = normalizeSessionRequest(input, "linux");
  assert.equal(first.requestHash, normalizeSessionRequest({ ...input, waitMs: 1, requestId: crypto.randomUUID(), spec: { command: "echo ok", shell: "sh", cwd: null, timeoutMs: 120000 } }, "linux").requestHash);
  assert.notEqual(first.requestHash, normalizeSessionRequest({ ...input, sequence: 2 }, "linux").requestHash);
  assert.notEqual(first.requestHash, normalizeSessionRequest({ ...input, sessionId: crypto.randomUUID() }, "linux").requestHash);
  assert.throws(() => normalizeSessionRequest({ ...input, spec: { command: "x\0y" } }, "linux"), { code: "SESSION_INVALID" });
  assert.throws(() => normalizeSessionRequest({ ...input, sequence: 10001 }, "linux"), { code: "SESSION_INVALID" });
});
