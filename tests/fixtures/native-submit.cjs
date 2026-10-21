"use strict";
const fs = require("node:fs"), crypto = require("node:crypto");
const { TaskManager } = require("../../src/pro/tasks.cjs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const manager = new TaskManager({ dir: config.dir, deviceId: config.deviceId, bootId: crypto.randomUUID(), authorized: owner => owner === config.owner });
if (!manager.identityAvailable) throw Error("Native process identity is required; this fixture cannot bypass the guard");
manager.submit(config.owner, config.input);
process.stdout.write(JSON.stringify({ operationId: config.input.operationId }) + "\n");
// No wait: the independent runner must survive this submitting process exiting.
