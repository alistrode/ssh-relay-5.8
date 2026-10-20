// Bounded explicit-state model checking, using production slot/discovery code.
// No remote connections, solver installation, or business commands are needed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createAgentDiscovery } from "../src/mcp/agent-provider.js";
const { DeviceSlots } = createRequire(import.meta.url)("../src/pro/device-slots.cjs");

const slots = new DeviceSlots();
let states = 0, transitions = 0;
// 7 devices, each absent/disabled/enabled, including all legacy overflow states.
// Paired-time ordering is fixed; device identities are symmetric in this model.
for (let encoding = 0; encoding < 3 ** 7; encoding++) {
  let value = encoding;
  const registry = Object.create(null);
  for (let i = 0; i < 7; i++) {
    const state = value % 3;
    value = Math.floor(value / 3);
    if (state) registry[String(i)] = { enabled: state === 2, pairedAt: i + 1 };
  }
  states++;
  const initial = JSON.stringify(registry), snapshot = slots.snapshot(registry);
  const enabled = Object.keys(registry).filter(k => registry[k].enabled);
  assert(snapshot.active.length <= 5);
  assert.deepEqual([...snapshot.active, ...snapshot.paused], enabled);
  assert.equal(JSON.stringify(registry), initial); // observation never deletes data
  assert.deepEqual(slots.snapshot(JSON.parse(initial)), snapshot); // restart
  for (let i = 0; i < 7; i++) {
    const key = String(i);
    let rejected = false;
    try { slots.assertCanEnable(registry, key); }
    catch (e) { assert.equal(e.code, "DEVICE_SLOT_LIMIT"); rejected = true; }
    const allowed = snapshot.active.includes(key) || enabled.filter(k => k !== key).length < 5;
    assert.equal(!rejected, allowed);
    if (!rejected) {
      const next = JSON.parse(initial);
      next[key] = { ...next[key], enabled: true, pairedAt: next[key]?.pairedAt ?? i + 1 };
      assert(slots.snapshot(next).active.length <= 5);
      if (snapshot.active.includes(key)) assert.deepEqual(slots.snapshot(next), snapshot);
    } else assert.equal(JSON.stringify(registry), initial); // rejection is atomic
    for (const operation of ["disable", "unpair"]) {
      const next = JSON.parse(initial);
      if (operation === "disable" && next[key]) next[key].enabled = false;
      if (operation === "unpair") delete next[key];
      const after = slots.snapshot(next);
      assert(after.active.length <= 5);
      assert(!after.active.includes(key));
      assert.equal(after.active.length, Math.min(5, Object.values(next).filter(d => d.enabled).length));
      transitions++;
    }
    transitions++;
  }
}

// All legal start/completion interleavings for three requests. Request IDs are
// assigned by start order. Completions may occur in any order, succeed or fail.
function* schedules(started = 0, pending = [], trace = []) {
  if (trace.length === 6) { yield trace; return; }
  if (started < 3) yield* schedules(started + 1, [...pending, started], [...trace, ["start", started]]);
  for (const id of pending)
    yield* schedules(started, pending.filter(x => x !== id), [...trace, ["finish", id]]);
}

async function checkSchedule(factory, trace, failures, payloads) {
  const deferred = [], jobs = [];
  let latest = -1, expected = null;
  const state = factory(() => new Promise((resolve, reject) => deferred.push({ resolve, reject })));
  for (const [event, id] of trace) {
    if (event === "start") {
      latest = id; expected = null;
      jobs[id] = state.refresh().catch(() => {});
    } else {
      const fail = Boolean(failures & (1 << id));
      if (fail) deferred[id].reject(Error("API unavailable"));
      else deferred[id].resolve({ publishedBy: id, deviceEnabled: Boolean(payloads & (1 << id)) });
      await jobs[id];
      if (id === latest && !fail) expected = id;
    }
    const observed = state.snapshot();
    assert.equal(observed.publishedBy ?? null, expected,
      JSON.stringify({ trace, failures, payloads, event, id, latest }));
    if (expected !== null)
      assert.equal(observed.deviceEnabled, Boolean(payloads & (1 << expected)));
  }
}

// Mutation check: the previous unguarded implementation must exhibit the race.
function unguarded(load) {
  let current = {};
  return { snapshot: () => current, async refresh() { current = {}; current = await load(); } };
}
const counterexample = [["start", 0], ["start", 1], ["finish", 1], ["finish", 0]];
await assert.rejects(checkSchedule(unguarded, counterexample, 0, 1));

let interleavings = 0, cases = 0;
for (const trace of schedules()) {
  interleavings++;
  for (let failures = 0; failures < 8; failures++)
    for (let payloads = 0; payloads < 8; payloads++) {
      await checkSchedule(createAgentDiscovery, trace, failures, payloads);
      cases++;
    }
}
console.log(JSON.stringify({
  method: "bounded explicit-state exploration against production functions",
  slots: { devices: 7, states, transitions, passed: true },
  discovery: { concurrentRequests: 3, interleavings, cases, passed: true,
    previousImplementationCounterexample: counterexample },
  limits: ["Not an unbounded or machine-checked refinement proof of the whole application",
    "Agent worker/SSH lifecycle, report-file races, side effects and platforms are not modeled",
    "Discovery freshness means newest request started, not atomic revocation at remote execution time",
    "No liveness guarantee under endless refresh, network failure, or unfair scheduling"]
}, null, 2));
