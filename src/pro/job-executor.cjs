"use strict";
const path = require("node:path");
const { createRequire } = require("node:module");
const { privateJSON } = require("./task-store.cjs");
const { normalizeJobSpec } = require("./task-spec.cjs");
const { jobFile, jobSource, sourceHash } = require("./task-jobs.cjs");
async function execute(directory) {
  const input = privateJSON(path.join(path.resolve(directory), "input.json"));
  const spec = normalizeJobSpec(input?.spec);
  const source = jobSource(spec.name);
  if (sourceHash(source) !== spec.sourceHash)
    throw Object.assign(Error("Controlled job version differs from the accepted task"), { code: "JOB_VERSION_MISMATCH" });
  const container = { exports: {} };
  // Execute exactly the bundled bytes whose hash was checked, never code from
  // request JSON or a second filesystem read during an application upgrade.
  new Function("module", "require", source)(container, createRequire(jobFile(spec.name)));
  const result = await container.exports(spec.args);
  process.stdout.write(JSON.stringify(result));
}
module.exports = { execute };
if (require.main === module) execute(process.argv[2]).catch(error => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
