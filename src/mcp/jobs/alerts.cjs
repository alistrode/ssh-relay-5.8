module.exports = async function (ARGS) {
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os");
  const dir = path.join(os.homedir(), ".relay-mcp"),
    file = path.join(dir, "alerts.json");
  const current = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {
        cpuThreshold: 80,
        memoryThreshold: 90,
        diskThreshold: 85,
        enabled: true,
      };
  if (ARGS.action === "set") {
    for (const k of ["cpuThreshold", "memoryThreshold", "diskThreshold"])
      if (ARGS[k] !== undefined) {
        if (!Number.isFinite(ARGS[k]) || ARGS[k] < 0 || ARGS[k] > 100)
          throw new Error("Threshold must be 0..100");
        current[k] = ARGS[k];
      }
    if (ARGS.enabled !== undefined) current.enabled = ARGS.enabled;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(current), { mode: 0o600 });
  }
  return {
    success: true,
    config: current,
    mode: "on-demand; no background notification daemon installed",
  };
};
