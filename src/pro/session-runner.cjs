"use strict";
const runtimeLog=require('./runtime-log.cjs').install('session-runner');
const fs = require("node:fs");
const path = require("node:path");
const { SessionEngine } = require("./session-engine.cjs");
const { operationId } = require("./task-spec.cjs");
const { normalizeSessionRequest } = require("./session-spec.cjs");
const { processIdentity } = require("./task-process.cjs");
const { folder, systemBootId } = require("./store.cjs");
const { privateJSON, durableWrite } = require("./task-store.cjs");
function failure(code, message) { return Object.assign(Error(message), { code }); }
async function run(directory) {
  await require("./task-process.cjs").prepareIdentity();
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
  if (config.executionBudgetVersion !== 1) throw failure("SESSION_INVALID", "Session execution budget version is unsupported");
  const osBoot = systemBootId(), identity = processIdentity(process.pid);
  if (!identity || !osBoot) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Session runner process identity cannot be verified");
  if (config.osBoot !== osBoot) throw failure("SESSION_LOST", "Session belongs to a previous system boot");
  const inbox = folder(path.join(directory, "inbox")), responses = folder(path.join(directory, "responses"));
  const runner = { ...identity, sessionId: config.sessionId, owner: config.owner,
    sessionDir: directory, heartbeatAt: Date.now() };
  const heartbeatFile = path.join(directory, "runner.json");
  durableWrite(heartbeatFile, runner);
  const engine = new SessionEngine({ ...config, dir: directory });
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
        const permit = privateJSON(path.join(directory, "permit.json"), null);
        const intent = privateJSON(path.join(directory, "requests", requestId + ".json"), null);
        const normalized = normalizeSessionRequest({ sessionId: config.sessionId, method: "send", ...envelope.params }, config.platform);
        if (!permit || permit.owner !== config.owner || permit.deviceId !== config.deviceId || permit.sessionId !== config.sessionId ||
            permit.requestId !== requestId || permit.requestHash !== normalized.requestHash ||
            !intent || intent.owner !== config.owner || intent.sessionId !== config.sessionId || intent.requestId !== requestId ||
            intent.method !== "send" || intent.requestHash !== normalized.requestHash)
          throw failure("SESSION_INVALID", "Session execution permit differs from saved command intent");
        const result = await engine.send(config.owner, { requestId, sequence: normalized.sequence, spec: normalized.spec });
        receipt(requestId, { ok: true, ...result });
        if (engine.closed) finishing = true;
      }
    } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-runner.cjs',line:79});
      const known = new Set(["SESSION_INVALID", "SESSION_LOST", "SESSION_UNAVAILABLE", "SESSION_SEQUENCE_CONFLICT",
        "REQUEST_CONFLICT", "INVALID_TASK_SPEC", "SESSION_CAPACITY", "SESSION_COMMAND_UNKNOWN", "SESSION_CORRUPT"]);
      receipt(requestId, { ok: false, errorCode: known.has(error.code) ? error.code : "SESSION_REQUEST_FAILED" });
    } finally {
      try { fs.unlinkSync(file); } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-runner.cjs',line:84}); if (error.code !== "ENOENT") throw error; }
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
        // Business input waits for the single persisted permit. Stop/revoke was
        // handled above and never waits for a business slot.
        const permit = privateJSON(path.join(directory, "permit.json"), null);
        if (!permit || permit.requestId !== requestId) continue;
        const file = path.join(inbox, name);
        pending.set(requestId, null);
        const work = handle(file, requestId).catch(error => { runtimeLog.record("session_request_boundary_failed",{requestId,error}); engine.close(config.owner); finishing = true; });
        // handle() can finish synchronously on invalid input; never restore a
        // stale pending entry after its finally block removed it.
        if (pending.has(requestId)) pending.set(requestId, work);
      }
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-runner.cjs',line:122}); engine.close(config.owner); finishing = true; }
    finally { polling = false; }
  }
  let heartbeat;
  let interval,watcher,idleDelay=50;
  function schedulePoll(){
    clearTimeout(interval);poll();
    idleDelay=pending.size?50:Math.min(500,idleDelay+50);
    if(!finishing)interval=setTimeout(schedulePoll,idleDelay);
  }
  // A bounded polling fallback remains for platforms where directory events coalesce.
  try{watcher=fs.watch(directory,{recursive:true},()=>{idleDelay=50;clearTimeout(interval);interval=setTimeout(schedulePoll,0);});watcher.on('error',error=>runtimeLog.record('session_watch_failed',{error}));}
  catch(error){runtimeLog.record('session_watch_unavailable',{error});}
  interval=setTimeout(schedulePoll,0);
  heartbeat = setInterval(() => {
    try { runner.heartbeatAt = Date.now(); runner.state = engine.closed ? "lost" : engine.journal.record.state;
      durableWrite(heartbeatFile, runner); }
    catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'session-runner.cjs',line:130}); engine.close(config.owner); finishing = true; }
  }, 2000);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (engine.closed) finishing = true;
      if (finishing && pending.size === 0) { clearInterval(check); resolve(); }
    }, 100);
  });
  clearTimeout(interval); watcher?.close(); clearInterval(heartbeat);
  engine.close(config.owner);
  runner.state = "lost"; runner.heartbeatAt = Date.now(); durableWrite(heartbeatFile, runner);
}
async function main(directory) {
  try { await run(directory); }
  catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'session-runner.cjs',line:144});
    const known = new Set(["PROCESS_IDENTITY_UNAVAILABLE", "SESSION_INVALID", "SESSION_LOST", "SESSION_ENGINE_EXISTS", "AUTH_REVOKED", "SESSION_CLOSED"]);
    try { durableWrite(path.join(path.resolve(directory), "runner-error.json"), {
      errorCode: known.has(error.code) ? error.code : "SESSION_RUNNER_FAILED", finishedAt: Date.now() }); } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'session-runner.cjs',line:147}); }
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv[2]);
module.exports = { run };
