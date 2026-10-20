"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { read } = require("./store.cjs");
const { request, ensure } = require("./agent-client.cjs");
module.exports = { request, ensure };
if (require.main === module)
  (async () => {
    const args = process.argv.slice(2),
      arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d),
      role = arg("--role", "near"),
      dir = path.resolve(
        arg("--state-dir", path.join(os.homedir(), ".ssh-relay-pro", role)),
      ),
      command = args[0];
    if (!["near", "far"].includes(role)) throw Error("Invalid role");
    if (["start", "pair-code", "pair", "retry"].includes(command))
      await ensure({
        dir,
        role,
        allowCloudSelfTest: args.includes("--allow-cloud-self-test"),
      });
    let value;
    if (command === "start" || command === "status" || command === "devices")
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
    console.log(JSON.stringify(value, null, 2));
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
