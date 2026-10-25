"use strict";
const path = require("node:path");
const kind = process.argv[2],
  config = process.argv[3];
if (!["near", "far"].includes(kind) || !config)
  throw Error("Invalid worker arguments");
// The dedicated IPC channel dies even if the parent is killed; never leave a
// second far/near worker attached to the same MQTT identity after agent restart.
if (typeof process.send === "function")
  process.once("disconnect", () => process.kill(process.pid, "SIGTERM"));
if (!process.env.SSH_RELAY_CLIENT_PROFILE || !require("./client-lifecycle.cjs").clientActive(path.join(process.env.SSH_RELAY_CLIENT_PROFILE, kind)))
  throw Error("客户端未运行，禁止独立工作进程");
process.argv[2] = config;
require(
  path.resolve(__dirname, "..", kind === "near" ? "near.cjs" : "remote.cjs"),
);
