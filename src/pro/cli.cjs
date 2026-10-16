"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  cp = require("node:child_process"),
  { folder, read } = require("./store.cjs");
function request(dir, route, body) {
  return new Promise((resolve, reject) => {
    let runtime;
    try {
      runtime = read(path.join(dir, "agent-runtime.json"));
      if (!runtime) throw Error("Agent is not running");
    } catch (e) {
      reject(e);
      return;
    }
    const r = http.request(
      {
        host: "127.0.0.1",
        port: runtime.port,
        path: route,
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + runtime.token,
          "Content-Type": "application/json",
        },
        timeout: 110000,
      },
      (res) => {
        let data = "";
        res.on("data", (b) => (data += b));
        res.on("end", () => {
          try {
            const value = JSON.parse(data);
            res.statusCode === 200
              ? resolve(value)
              : reject(Error(value.error || "Agent request failed"));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("error", reject);
    r.on("timeout", () => r.destroy(Error("Agent request timeout")));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function ensure({
  dir,
  role,
  allowCloudSelfTest = false,
  testHooks = false,
}) {
  try {
    await request(dir, "/status");
    return;
  } catch {}
  folder(dir);
  const fd = fs.openSync(path.join(dir, "bootstrap.log"), "a", 0o600),
    p = cp.spawn(
      process.execPath,
      [
        path.join(__dirname, "guardian.cjs"),
        "--state-dir",
        dir,
        "--role",
        role,
        ...(allowCloudSelfTest ? ["--allow-cloud-self-test"] : []),
        ...(testHooks ? ["--test-hooks"] : []),
      ],
      {
        stdio: ["ignore", fd, fd],
        detached: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
      },
    );
  p.unref();
  fs.closeSync(fd);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      await request(dir, "/status");
      return;
    } catch {}
  }
  throw Error("Agent could not start; inspect the private bootstrap.log");
}
module.exports = { request, ensure };
if (require.main === module)
  (async () => {
    const args = process.argv.slice(2),
      arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d),
      role = arg("--role", "near"),
      dir = path.resolve(
        arg("--state-dir", path.join(os.homedir(), ".ssh-relay-pro", role)),
      ),
      command = args[0];
    if (!["near", "far"].includes(role)) throw Error("Invalid role");
    if (["start", "pair-code", "pair", "retry"].includes(command))
      await ensure({
        dir,
        role,
        allowCloudSelfTest: args.includes("--allow-cloud-self-test"),
      });
    let value;
    if (command === "start" || command === "status" || command === "devices")
      value = await request(dir, "/status");
    else if (command === "pair-code")
      value = await request(dir, "/pair/create", {});
    else if (command === "pair") {
      const file = arg("--code-file");
      if (!file)
        throw Error(
          "Use --code-file /private/code.txt, not a command-line password",
        );
      value = await request(dir, "/pair/connect", {
        code: fs.readFileSync(file, "utf8").trim(),
      });
    } else if (command === "retry") value = await request(dir, "/retry", {});
    else if (command === "stop") value = await request(dir, "/shutdown", {});
    else if (command === "logs") value = await request(dir, "/logs");
    else
      throw Error(
        "Commands: start, status, devices, pair-code, pair --code-file, retry, logs, stop",
      );
    console.log(JSON.stringify(value, null, 2));
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
