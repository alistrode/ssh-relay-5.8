import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import { catalog } from "../../src/mcp/catalog.js";
const baseline = JSON.parse(fs.readFileSync(new URL("../fixtures/mcp-original-schemas.json", import.meta.url), "utf8"));
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["description", "$schema"].includes(key)).map(([key, child]) => [key, normalized(child)]));
  return value;
}
test("all 37 original tool names and input constraints match the documented source baseline", () => {
  assert.equal(Object.keys(baseline.tools).length, 37);
  assert.deepEqual(catalog.map(tool => tool.name).sort(), Object.keys(baseline.tools).sort());
  for (const tool of catalog) assert.deepEqual(normalized(z.toJSONSchema(z.object(tool.config.inputSchema))), baseline.tools[tool.name], tool.name);
});
