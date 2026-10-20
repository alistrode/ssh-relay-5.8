"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const NAMES = Object.freeze(["alerts", "backup", "database", "health", "schedule", "tail"]);
function jobFile(name) {
  if (!NAMES.includes(name))
    throw Object.assign(Error("Unknown controlled job"), { code: "UNSUPPORTED_JOB" });
  return path.resolve(__dirname, "../mcp/jobs", name + ".cjs");
}
function jobHash(name) {
  return sourceHash(jobSource(name));
}
function jobSource(name) { return fs.readFileSync(jobFile(name), "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n"; }
function sourceHash(source) { return crypto.createHash("sha256").update(source).digest("hex"); }
function jobCatalog() {
  const catalog = {};
  for (const name of NAMES) {
    try { catalog[name] = jobHash(name); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return catalog;
}
module.exports = { NAMES, jobFile, jobSource, sourceHash, jobHash, jobCatalog };
