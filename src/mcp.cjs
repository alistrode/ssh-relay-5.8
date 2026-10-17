#!/usr/bin/env node
"use strict";
// CLI state selection happens before any ESM module creates application state.
const path = require("node:path");
const args = process.argv.slice(2),
  at = args.indexOf("--state-dir");
if (at >= 0) {
  if (!args[at + 1]) throw new Error("--state-dir requires a path");
  process.env.RELAY_MCP_STATE_DIR = path.resolve(args[at + 1]);
}
import("./mcp/server.js").catch((error) => {
  console.error("MCP startup failed: " + error.message);
  process.exitCode = 1;
});
