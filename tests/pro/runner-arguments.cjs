"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { runnerArgumentsMatch } = require("../../src/pro/task-process.cjs");
test("runner ownership requires full directory and script argument boundaries", () => {
  const dir = path.resolve("private-session");
  assert.equal(runnerArgumentsMatch({ args: ["node", "/app/session-runner.cjs", dir] }, dir, "session-runner.cjs"), true);
  assert.equal(runnerArgumentsMatch({ args: ["node", "/app/task-runner.cjs", dir] }, dir, "session-runner.cjs"), false);
  assert.equal(runnerArgumentsMatch({ args: ["node", "/app/session-runner.cjs.backup", dir] }, dir, "session-runner.cjs"), false);
  assert.equal(runnerArgumentsMatch({ args: ["node", "/app/session-runner.cjs", dir + "-other"] }, dir, "session-runner.cjs"), false);
});
test("Windows quoted paths are matched as complete arguments", () => {
  const dir = path.resolve("private session"), quoted = '"' + dir + '"';
  assert.equal(runnerArgumentsMatch({ command: '"C:\\app dir\\node.exe" "C:\\app dir\\session-runner.cjs" ' + quoted }, dir, "session-runner.cjs", true), true);
  assert.equal(runnerArgumentsMatch({ command: 'node C:\\app\\session-runner.cjs "' + dir + '-other"' }, dir, "session-runner.cjs", true), false);
  assert.equal(runnerArgumentsMatch({ command: 'node C:\\app\\session-runner.cjs.backup ' + quoted }, dir, "session-runner.cjs", true), false);
});
