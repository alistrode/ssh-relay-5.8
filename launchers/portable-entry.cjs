"use strict";
// Packaging entry only: business operations stay in the existing Agent/MCP.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../../.."), appRoot = path.resolve(__dirname, "..");
const { role } = JSON.parse(fs.readFileSync(path.join(root, "PACKAGE.json")));
if (!["near", "far"].includes(role)) throw Error("Invalid package role");
const vendor = path.join(root, "vendor");
const paths = [path.join(root, "runtime")];
if (fs.existsSync(vendor)) for (const item of fs.readdirSync(vendor)) paths.push(path.join(vendor, item, "bin"));
process.env.PATH = [...paths, process.env.PATH || ""].join(path.delimiter);
if (process.platform === "linux") process.env.LD_LIBRARY_PATH = [...(fs.existsSync(vendor) ? fs.readdirSync(vendor).map(item => path.join(vendor, item, "lib")) : []), process.env.LD_LIBRARY_PATH || ""].join(":");
const args = process.argv.slice(2);
if (args[0] === "--mcp") {
  process.argv = [process.execPath, path.join(appRoot, "src/mcp.cjs"), ...args.slice(1)];
  require("../src/mcp.cjs");
} else if (args[0] === "--cli") {
  const child = cp.spawn(process.execPath, [path.join(appRoot, "src/pro/cli.cjs"), ...args.slice(1), "--role", role], { stdio: "inherit", env: process.env });
  child.on("exit", code => { process.exitCode = code ?? 1; });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
} else (async () => {
  const { ensureAgent } = require("../src/pro/agent-client.cjs");
  const agent = await ensureAgent({ role });
  const stateDir = path.join(os.homedir(), ".ssh-relay-pro", role);
  console.log("SSH Relay Pro — " + (role === "near" ? "近端" : "远端") + "\n后台已启动，状态目录：" + stateDir);
  if (role === "near") {
    const config = { mcpServers: { "ssh-relay": { command: process.execPath, args: [__filename, "--mcp"] } } };
    fs.writeFileSync(path.join(root, "MCP-CONFIG.json"), JSON.stringify(config, null, 2) + "\n");
    console.log("AI/MCP 配置已生成：MCP-CONFIG.json。将配置加入你的 AI 客户端。首次连接请让 AI 使用 ssh_connect 输入远端配对码。\n也可打开 Open-UI 图形管理界面完成配对。");
  } else {
    const offer = await agent.request("POST", "/pair/create", {});
    console.log("一次性配对码（不要公开，五分钟有效）：\n" + offer.code);
    console.log("将配对码交给近端 AI 的 ssh_connect 或近端图形界面。\n再次运行 Start 可生成新码；已有授权无需重新配对。");
  }
  console.log("关闭此窗口保留后台；Stop 入口可停止本角色。Open-UI 是现有的双角色管理界面。");
  if (!args.includes("--headless")) {
    require("./portable-ui.cjs").launch(root);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
