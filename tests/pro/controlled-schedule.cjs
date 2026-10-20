"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const schedule = require("../../src/mcp/jobs/schedule.cjs");
const { jobHash } = require("../../src/pro/task-jobs.cjs");
test("controlled schedule stores private arguments and a version-pinned bundled module reference",
  { skip: process.platform !== "linux" }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-schedule-fixture-"));
    const oldHome = os.homedir, oldSpawn = cp.spawnSync, calls = [];
    os.homedir = () => dir;
    cp.spawnSync = (name, args, options) => {
      calls.push({ name, args, input: options?.input });
      if (name === "crontab" && args[0] === "-l") return { status: 1, stdout: "", stderr: "no crontab" };
      return { status: 0, stdout: "", stderr: "" };
    };
    t.after(() => {
      os.homedir = oldHome; cp.spawnSync = oldSpawn;
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const controlledJob = { name: "database", sourceHash: jobHash("database"),
      args: { action: "backup", type: "mysql", name: "fixture", dbPassword: "fixture-private-password" } };
    const result = await schedule({ name: "fixture", schedule: "0 1 * * *", controlledJob }, { controlled: true });
    assert.equal(result.success, true);
    const script = fs.readFileSync(result.runner, "utf8");
    assert.equal(script.includes("fixture-private-password"), false);
    assert.equal(script.includes("registry.sourceHash"), true);
    const config = JSON.parse(fs.readFileSync(result.runner + ".json", "utf8"));
    assert.equal(config.args.dbPassword, "fixture-private-password");
    assert.equal(fs.statSync(result.runner + ".json").mode & 0o077, 0);
    assert.deepEqual(calls.map(call => call.name), ["crontab", "crontab"]);
    calls.length = 0;
    await assert.rejects(schedule({ name: "refused", schedule: "* * * * *",
      script: "unexpected implementation", controlledJob }, { controlled: true }),
      /do not accept implementation source/);
    assert.equal(calls.length, 0);
  });
