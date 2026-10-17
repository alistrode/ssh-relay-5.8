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
process.argv[2] = config;
require(
  path.resolve(__dirname, "..", kind === "near" ? "near.cjs" : "remote.cjs"),
);
