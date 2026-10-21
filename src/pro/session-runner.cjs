"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { SessionEngine } = require("./session-engine.cjs");
const { operationId } = require("./task-spec.cjs");
const { processIdentity } = require("./task-process.cjs");
const { folder, systemBootId } = require("./store.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
async function run(directory) {
  directory = path.resolve(directory);
  const config = privateJSON(path.join(directory, "session.json"));
  if (!config || config.schemaVersion !== 1) throw failure("SESSION_INVALID", "Session runner configuration is invalid");
  for (const name of ["sessionId", "deviceId", "owner"]) operationId(config[name]);
  const platform = process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : null;
  if (!platform || config.platform !== platform) throw failure("SESSION_INVALID", "Session platform differs from the runner platform");
  const revocationFile = path.join(directory, "revoke.json");
  function revoked() {
    const record = privateJSON(revocationFile, null);
    if (!record) return null;
    if (record.owner !== config.owner || record.sessionId !== config.sessionId)
      throw failure("SESSION_INVALID", "Session revocation identity is invalid");
    operationId(record.requestId);
    return record;
  }
  if (revoked()) throw failure("AUTH_REVOKED", "Session controller authorization was revoked");
  function closing() {
    const record = privateJSON(path.join(directory, "close.json"), null);
    if (!record) return null;
    if (record.owner !== config.owner || record.sessionId !== config.sessionId)
      throw failure("SESSION_INVALID", "Session close identity is invalid");
    operationId(record.requestId); return record;
  }
  const initialClose = closing();
  if (initialClose) {
    durableWrite(path.join(directory, "responses", initialClose.requestId + ".json"), {
      sessionId: config.sessionId, requestId: initialClose.requestId, ok: true, state: "lost", stopRequested: true });
    throw failure("SESSION_CLOSED", "Session was closed before shell startup");
  }
  const osBoot = systemBootId(), identity = processIdentity(process.pid);
  if (!identity || !osBoot) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Session runner process identity cannot be verified");
  if (config.osBoot !== osBoot) throw failure("SESSION_LOST", "Session belongs to a previous system boot");
  const inbox = folder(path.join(directory, "inbox")), responses = folder(path.join(directory, "responses"));
  const engine = new SessionEngine({ ...config, dir: directory });
  const runner = { ...identity, sessionId: config.sessionId, owner: config.owner,
    sessionDir: directory, heartbeatAt: Date.now() };
  const heartbeatFile = path.join(directory, "runner.json");
  durableWrite(heartbeatFile, runner);
  const pending = new Map(); let finishing = false, polling = false;
  function receipt(requestId, value) {
    durableWrite(path.join(responses, requestId + ".json"), { requestId, sessionId: config.sessionId, ...value });
  }
  async function handle(file, requestId) {
    try {
      const envelope = privateJSON(file);
      if (!envelope || envelope.requestId !== requestId || envelope.sessionId !== config.sessionId ||
          !["send", "close"].includes(envelope.method)) throw failure("SESSION_INVALID", "Session request envelope is invalid");
      // The runner's fixed owner comes from the private startup record. Future
      // authenticated Agent RPC must bind this directory before writing inbox.
      if (envelope.method === "close") {
        receipt(requestId, { ok: true, ...engine.close(config.owner) }); finishing = true;
      } else {
        if (envelope.params?.requestId !== requestId) throw failure("SESSION_INVALID", "Session command request ID differs from envelope");
        const result = await engine.send(config.owner, envelope.params);
        receipt(requestId, { ok: true, ...result });
        if (engine.closed) finishing = true;
      }
    } catch (error) {
      const known = new Set(["SESSION_INVALID", "SESSION_LOST", "SESSION_UNAVAILABLE", "SESSION_SEQUENCE_CONFLICT",
        "REQUEST_CONFLICT", "INVALID_TASK_SPEC", "SESSION_CAPACITY", "SESSION_COMMAND_UNKNOWN", "SESSION_CORRUPT"]);
      receipt(requestId, { ok: false, errorCode: known.has(error.code) ? error.code : "SESSION_REQUEST_FAILED" });
    } finally {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
      pending.delete(requestId);
    }
  }
  function poll() {
    if (polling || finishing) return;
    polling = true;
    try {
      const revocation = revoked();
      if (revocation) {
        engine.fail("AUTH_REVOKED"); finishing = true;
        durableWrite(path.join(directory, "revoke-result.json"), { owner: config.owner, sessionId: config.sessionId,
          requestId: revocation.requestId, state: "lost", stopRequested: true, observedAt: Date.now() });
        return;
      }
      const closeRequest = closing();
      if (closeRequest) {
        engine.close(config.owner); finishing = true;
        receipt(closeRequest.requestId, { ok: true, state: "lost", stopRequested: true });
        return;
      }
      const names = fs.readdirSync(inbox);
      if (names.length > 64) { engine.close(config.owner); finishing = true; return; }
      for (const name of names) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const requestId = operationId(name.slice(0, -5));
        if (pending.has(requestId)) continue;
        const file = path.join(inbox, name);
        pending.set(requestId, null);
        const work = handle(file, requestId).catch(() => { engine.close(config.owner); finishing = true; });
        // handle() can finish synchronously on invalid input; never restore a
        // stale pending entry after its finally block removed it.
        if (pending.has(requestId)) pending.set(requestId, work);
      }
    } catch { engine.close(config.owner); finishing = true; }
    finally { polling = false; }
  }
  let heartbeat;
  const interval = setInterval(poll, 50);
  heartbeat = setInterval(() => {
    try { runner.heartbeatAt = Date.now(); runner.state = engine.closed ? "lost" : engine.journal.record.state;
      durableWrite(heartbeatFile, runner); }
    catch { engine.close(config.owner); finishing = true; }
  }, 2000);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (engine.closed) finishing = true;
      if (finishing && pending.size === 0) { clearInterval(check); resolve(); }
    }, 50);
  });
  clearInterval(interval); clearInterval(heartbeat);
  engine.close(config.owner);
  runner.state = "lost"; runner.heartbeatAt = Date.now(); durableWrite(heartbeatFile, runner);
}
async function main(directory) {
  try { await run(directory); }
  catch (error) {
    const known = new Set(["PROCESS_IDENTITY_UNAVAILABLE", "SESSION_INVALID", "SESSION_LOST", "SESSION_ENGINE_EXISTS", "AUTH_REVOKED", "SESSION_CLOSED"]);
    try { durableWrite(path.join(path.resolve(directory), "runner-error.json"), {
      errorCode: known.has(error.code) ? error.code : "SESSION_RUNNER_FAILED", finishedAt: Date.now() }); } catch {}
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv[2]);
module.exports = { run };
