"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionOutput } = require("../../src/pro/session-output.cjs");
const marker = "RELAY_" + "a".repeat(32);
const trailer = Buffer.from("\n" + marker + ":0:" + Buffer.from("/tmp/中文").toString("base64") + "\n");
const stderrEnd = Buffer.from("\n" + marker + ":END\n");
test("every split preserves raw UTF-8 and completion waits for both pipes", () => {
  const payload = Buffer.from("中文 output\n"), framed = Buffer.concat([payload, trailer]);
  for (let split = 0; split <= framed.length; split++) {
    const output = []; let result;
    const parser = new SessionOutput({ marker, onData: (name, bytes) => output.push(Buffer.from(bytes)), onComplete: value => { result = value; } });
    parser.feed("stdout", framed.subarray(0, split)); parser.feed("stdout", framed.subarray(split));
    assert.equal(result, undefined);
    parser.feed("stderr", stderrEnd);
    assert.equal(result.cwd, "/tmp/中文"); assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(output), payload); parser.close();
  }
});
test("output truncation continues parsing and late bytes are separate", () => {
  const output = [], extra = []; let result;
  const parser = new SessionOutput({ marker, limitBytes: 3,
    onData: (name, bytes) => output.push(Buffer.from(bytes)), onExtra: (name, bytes) => extra.push(Buffer.from(bytes)),
    onComplete: value => { result = value; } });
  parser.feed("stderr", stderrEnd);
  parser.feed("stdout", Buffer.concat([Buffer.from("abcdef"), trailer, Buffer.from("background")]));
  parser.feed("stdout", Buffer.from("more"));
  assert.equal(Buffer.concat(output).toString(), "abc");
  assert.deepEqual(result.output.stdout, { totalBytes: 6, storedBytes: 3, truncated: true });
  assert.equal(Buffer.concat(extra).toString(), "backgroundmore");
});
test("malformed trailers and missing boundaries never complete a command", () => {
  let completed = false;
  const make = () => new SessionOutput({ marker, onData: () => {}, onComplete: () => { completed = true; } });
  const parser = make(); parser.feed("stdout", trailer);
  assert.throws(() => parser.close(), { code: "SESSION_COMMAND_UNKNOWN" });
  assert.throws(() => make().feed("stderr", Buffer.from("\n" + marker + ":invalid\n")), { code: "SESSION_OUTPUT_INVALID" });
  assert.throws(() => make().feed("stdout", Buffer.from("\n" + marker + ":0:/w==\n")), { code: "SESSION_OUTPUT_INVALID" });
  assert.throws(() => make().feed("stdout", Buffer.from("\n" + marker + ":" + "x".repeat(262144))), { code: "SESSION_OUTPUT_INVALID" });
  assert.equal(completed, false);
});
test("invalid bytes permanently fail the parser instead of accepting later completion", () => {
  let completed = false;
  const parser = new SessionOutput({ marker, onData: () => {}, onComplete: () => { completed = true; } });
  const invalid = Buffer.concat([Buffer.from("\n" + marker + ":"), Buffer.from([0xc5]), Buffer.from("ND\n")]);
  assert.throws(() => parser.feed("stderr", invalid), { code: "SESSION_OUTPUT_INVALID" });
  assert.throws(() => parser.feed("stdout", trailer), { code: "SESSION_OUTPUT_INVALID" });
  assert.throws(() => parser.close(), { code: "SESSION_COMMAND_UNKNOWN" });
  assert.equal(completed, false);
});
