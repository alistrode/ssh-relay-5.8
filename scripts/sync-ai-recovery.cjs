"use strict";
const fs = require("node:fs"), path = require("node:path");
const { recoveryInstructions } = require("../src/pro/ai-recovery.cjs");
const root = path.resolve(__dirname, "..");
const targets = ["AGENTS.md", ".agents/skills/ssh-relay/SKILL.md", "docs/AI-RECOVERY-5.5.md",
  "docs/SSH-RELAY-CONTINUE-DEVELOPMENT.md", "docs/SSH-RELAY-END-TO-END-DESIGN.md",
  "docs/SSH-RELAY-DEVELOPMENT-HANDOFF.md"];
const start = "<!-- ai-recovery-policy:start -->", end = "<!-- ai-recovery-policy:end -->";
const block = start + "\n## 5.5 AI 断线恢复与任务继续规则\n\n" + recoveryInstructions + "\n\n" + end;
for (const name of targets) {
  const file = path.join(root, name), before = fs.readFileSync(file, "utf8");
  const a = before.indexOf(start), b = before.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && b < a)) throw Error("Invalid policy markers: " + name);
  let after;
  if (a >= 0) after = before.slice(0, a) + block + before.slice(b + end.length);
  else {
    // Keep YAML frontmatter intact; place the current policy before historical prose.
    const front = before.startsWith("---\n") ? before.indexOf("\n---", 4) + 4 : 0;
    after = before.slice(0, front) + "\n\n" + block + "\n\n" + before.slice(front).trimStart();
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
  }
}
console.log("AI recovery policy synchronized across " + targets.length + " documents.");
