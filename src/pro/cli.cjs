"use strict";
const runtimeLog=require('./runtime-log.cjs').install('cli');
const { recoveryInstructions, withRecovery } = require("./ai-recovery.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { request, ensure, ensureAgent } = require("./agent-client.cjs");
async function stdinJSON() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 40000) throw Error("stdin JSON exceeds 40000 bytes");
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'cli.cjs',line:19}); throw Error("Invalid stdin JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected a JSON object from stdin");
  return value;
}
module.exports = { request, ensure };
if (require.main === module)
  (async () => {
    const args = process.argv.slice(2),
      arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d),
      role = arg("--role", "near"),
      dir = path.resolve(
        arg("--state-dir", path.join(os.homedir(), ".ssh-relay-pro-5.5", role)),
      ),
      command = args[0];
    if (!["near", "far"].includes(role)) throw Error("Invalid role");
    if (["operations", "operation-status", "operation-cancel"].includes(command)) {
      if (role !== "near") throw Error("Operation discovery requires near role");
      if (command !== "operations" && !args.includes("--args-stdin"))
        throw Error("Use --args-stdin for operation input");
      const input = args.includes("--args-stdin") ? await stdinJSON() : {};
      const client = await ensureAgent({ dir, role });
      const value = command === "operations" ? await client.operations(input) :
        command === "operation-cancel" ? await client.cancelOperation(input.operationId, input.requestId || crypto.randomUUID()) :
        await client.operation(input.operationId, Object.fromEntries(
          Object.entries({ stdoutOffset: input.stdoutOffset, stderrOffset: input.stderrOffset,
            limitBytes: input.limitBytes }).filter(([, value]) => value !== undefined)));
      console.log(JSON.stringify(withRecovery(value), null, 2));
      if (value.ok === false) process.exitCode = 1;
      return;
    }
    if (command === "help" || command === "--help") {
      console.log(recoveryInstructions);
      console.log("Commands: start, status, devices, pair-code, pair --code-file, connect --args-stdin, connection-task --id UUID, disconnect --args-stdin, operations, operation-status --args-stdin, operation-cancel --args-stdin, retry, logs, stop. connect stdin: {requestId?,code|deviceId,waitMs?}; disconnect stdin: {requestId?,deviceId}; operation stdin: {operationId,stdoutOffset?,stderrOffset?,limitBytes?,requestId?}. Pairing codes stay off the command line.");
      return;
    }
    if (["connect", "connection-task", "disconnect"].includes(command)) {
      if (role !== "near") throw Error("Device connections require near role");
      if (command !== "connection-task" && !args.includes("--args-stdin"))
        throw Error("Use --args-stdin for connection input");
      const input = command === "connection-task" ? null : await stdinJSON();
      const client = await ensureAgent({ dir, role,
        allowCloudSelfTest: args.includes("--allow-cloud-self-test") });
      const result = command === "connection-task"
        ? await client.connectionTask(arg("--id", ""))
        : command === "connect"
          ? await client.connect({ ...input, requestId: input.requestId || crypto.randomUUID() })
          : await client.disconnect(input.deviceId, input.requestId || crypto.randomUUID());
      console.log(JSON.stringify(withRecovery(result, input || { connectionTaskId: arg("--id", "") }), null, 2));
      // Reading a failed historical request succeeded. Its outcome remains in
      // result.ok/requestStatus; it is not a failed status query or live probe.
      if (command !== "connection-task" && result.ok === false) process.exitCode = 1;
      return;
    }
    if (["start", "pair-code", "pair", "retry"].includes(command))
      await ensure({
        dir,
        role,
        allowCloudSelfTest: args.includes("--allow-cloud-self-test"),
      });
    let value;
    if (command === "devices" && role === "near")
      value = await request(dir, "/v55/devices");
    else if (command === "start" || command === "status" || command === "devices")
      value = await request(dir, "/status");
    else if (command === "pair-code")
      value = await request(dir, "/pair/create", {});
    else if (command === "pair") {
      const file = arg("--code-file");
      if (!file)
        throw Error(
          "Use --code-file /private/code.txt, not a command-line password",
        );
      value = await request(dir, "/pair/connect", {
        code: fs.readFileSync(file, "utf8").trim(),
      });
    } else if (command === "retry") value = await request(dir, "/retry", {});
    else if (command === "stop") value = await request(dir, "/shutdown", {});
    else if (command === "logs") value = await request(dir, "/logs");
    else
      throw Error(
        "Commands: start, status, devices, pair-code, pair --code-file, retry, logs, stop",
      );
    console.log(JSON.stringify(withRecovery(value), null, 2));
  })().catch((e) => {
    runtimeLog.record("cli_failed",{error:e});
    console.error(JSON.stringify(withRecovery({ ok: false, error: { code: e.code, message: e.message, retryable: e.retryable }, connectionTaskId: e.connectionTaskId, recovery: e.recovery }), null, 2));
    process.exitCode = 1;
  });

