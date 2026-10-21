import test from "node:test";
import assert from "node:assert/strict";
import { planGroupTargets } from "../../src/mcp/group-targets.js";

const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
test("one to five distinct devices retain their requested order", () => {
  const names = ["first", "second"];
  assert.deepEqual(planGroupTargets(names, n => ({ agentDeviceId: n === "first" ? a : b })), names);
});
test("two aliases for one device are rejected before execution", () => {
  assert.throws(() => planGroupTargets(["alpha", "alias"], () => ({ agentDeviceId: a })),
    /duplicate target/);
});
test("six members are rejected even when offline", () => {
  assert.throws(() => planGroupTargets(["a","b","c","d","e","f"], () => {
    throw Error("offline");
  }), /one and five/);
});
test("unresolved members are left for per-target error reporting", () => {
  assert.deepEqual(planGroupTargets(["ready", "missing"], n => {
    if (n === "missing") throw Error("unknown");
    return { agentDeviceId: a };
  }), ["ready", "missing"]);
});
test("legacy aliases use canonical server names for duplicate protection", () => {
  assert.throws(() => planGroupTargets(["alpha", "production-alias"], () => ({ name: "alpha" })),
    /duplicate target/);
});

test("unresolved repeated names cannot execute twice", () => {
  assert.throws(() => planGroupTargets(["missing", "MISSING"], () => {
    throw Error("offline");
  }), /duplicate server names/);
});
