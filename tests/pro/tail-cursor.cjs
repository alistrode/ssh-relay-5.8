"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const tail = require("../../src/mcp/jobs/tail.cjs");
test("tail resumes a split UTF-8 character without losing bytes and marks source replacement", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-tail-cursor-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "log"); fs.writeFileSync(file, "old\n");
  const first = await tail({ file, lines: 0, follow: false });
  const character = Buffer.from("中"); fs.appendFileSync(file, character.subarray(0, 1));
  const partial = await tail({ file, cursor: first.cursor, follow: false });
  assert.equal(partial.output, ""); assert.equal(Buffer.from(partial.cursor.pendingUTF8, "base64").length, 1);
  fs.appendFileSync(file, Buffer.concat([character.subarray(1), Buffer.from("\n")]));
  const resumed = await tail({ file, cursor: partial.cursor, follow: false });
  assert.equal(resumed.output, "中"); assert.equal(resumed.cursor.pendingUTF8, "");
  fs.renameSync(file, file + ".old"); fs.writeFileSync(file, "replacement\n");
  const replaced = await tail({ file, cursor: resumed.cursor, follow: false });
  assert.equal(replaced.cursorReset, true); assert.equal(replaced.output, "replacement");
});
