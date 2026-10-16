"use strict";
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var crypto = require("node:crypto");
var { spawn } = require("node:child_process");
var { Server, utils } = require("ssh2");
var { createRelay } = require("./relay.cjs");
var { createTraceWriter } = require("./diagnostics.cjs");
var { serveSftp } = require("./sftp.cjs");
var { attachForwarding } = require("./forwarding.cjs");
var { inspectPermissions, requireUsableContext } = require("./permissions.cjs");
var executionContext = inspectPermissions();
requireUsableContext(executionContext);
var root = path.resolve(process.argv[2] || path.join(__dirname, "config"));
var config = JSON.parse(
  fs.readFileSync(path.join(root, "remote.json"), "utf8"),
);
var allowed = utils.parseKey(
  fs.readFileSync(path.join(root, "client_key.pub")),
);
if (allowed instanceof Error) throw allowed;
function authorizedKey(ctx) {
  try {
    const keys = config.clientKeysFile
      ? Object.values(
          JSON.parse(fs.readFileSync(config.clientKeysFile, "utf8")),
        ).map((v) => utils.parseKey(v.publicKey))
      : [allowed];
    return keys.some(
      (key) =>
        !(key instanceof Error) &&
        ctx.key.data.equals(key.getPublicSSH()) &&
        (!ctx.signature ||
          key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true),
    );
  } catch {
    return false;
  }
}
var hostKey = fs.readFileSync(path.join(root, "host_key"));
var parsedHost = utils.parseKey(hostKey);
if (parsedHost instanceof Error) throw parsedHost;
var fingerprint =
  "SHA256:" +
  crypto
    .createHash("sha256")
    .update(parsedHost.getPublicSSH())
    .digest("base64")
    .replace(/=+$/, "");
var children = /* @__PURE__ */ new Set();
var clients = /* @__PURE__ */ new Set();
var recordTrace = createTraceWriter(root, "far");
var nextSshId = 0;
var traceSsh = (event, details = {}) => {
  const entry = {
    time: new Date().toISOString(),
    event: "ssh_" + event,
    ...details,
  };
  recordTrace(entry);
  console.error("SSH_TRACE " + JSON.stringify(entry));
};
var server = new Server({ hostKeys: [hostKey] }, (client, info) => {
  const sshId = ++nextSshId;
  traceSsh("accepted", { sshId, sourcePort: info.port });
  client.on("handshake", () => traceSsh("handshake", { sshId }));
  client.on("end", () => traceSsh("end", { sshId }));
  clients.add(client);
  client.on("error", (error) =>
    traceSsh("error", { sshId, code: error.code, message: error.message }),
  );
  client.on("close", () => {
    traceSsh("close", { sshId });
    clients.delete(client);
  });
  client.on("authentication", (ctx) => {
    if (
      ctx.username !== config.user ||
      ctx.method !== "publickey" ||
      !authorizedKey(ctx)
    ) {
      return ctx.reject(["publickey"]);
    }
    traceSsh("authenticated", { sshId });
    ctx.accept();
  });
  client.on("ready", () => {
    console.log("SSH public-key authentication succeeded.");
    traceSsh("ready", { sshId });
    attachForwarding(client);
    client.on("session", (accept) => {
      const session = accept();
      function start(accept2, command) {
        const stream = accept2();
        const windows = process.platform === "win32";
        const shell = windows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
        const args =
          command === void 0
            ? windows
              ? ["/Q"]
              : ["-s"]
            : windows
              ? ["/d", "/s", "/c", command]
              : ["-c", command];
        const commandEnv = { ...process.env };
        delete commandEnv.ELECTRON_RUN_AS_NODE;
        const child = spawn(shell, args, {
          env: commandEnv,
          cwd: os.homedir(),
          windowsHide: true,
          detached: !windows,
          stdio: "pipe",
        });
        children.add(child);
        traceSsh("process_start", {
          sshId,
          pid: child.pid,
          interactive: command === void 0,
        });
        child.terminate = (signal = "SIGTERM") => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          if (windows) {
            const killer = spawn(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.on("error", () => child.kill());
          } else {
            try {
              process.kill(-child.pid, signal);
            } catch {
              child.kill(signal);
            }
          }
        };
        session.on("signal", (acceptSignal, rejectSignal, info) => {
          const signal = info.name.startsWith("SIG")
            ? info.name
            : "SIG" + info.name;
          if (
            !["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGQUIT"].includes(
              signal,
            )
          )
            return rejectSignal?.();
          child.terminate(signal);
          acceptSignal?.();
        });
        stream.pipe(child.stdin);
        child.stdin.on("error", () => {});
        child.stdout.pipe(stream, { end: false });
        child.stderr.pipe(stream.stderr, { end: false });
        let finished = false;
        child.on("error", (error) => {
          if (finished) return;
          finished = true;
          stream.stderr.write(error.message + "\n");
          stream.exit(1);
          stream.end();
        });
        child.on("close", (code) => {
          traceSsh("process_close", { sshId, pid: child.pid, code });
          children.delete(child);
          if (finished) return;
          finished = true;
          stream.exit(code === null ? 1 : code);
          stream.end();
        });
        stream.on("close", () => {
          traceSsh("channel_close", {
            sshId,
            pid: child.pid,
            processFinished: finished,
          });
          if (!finished) child.terminate();
        });
      }
      session.on("exec", (accept2, reject, info2) =>
        start(accept2, info2.command),
      );
      session.on("shell", (accept2) => start(accept2));
      session.on("sftp", (accept2) => serveSftp(accept2()));
    });
  });
});
server.on("error", (error) => {
  console.error("SSH server:", error.message);
  process.exit(1);
});
var relay;
var heartbeat;
server.listen(config.sshPort, "127.0.0.1", () => {
  config.sshPort = server.address().port;
  console.log(
    "SSH service ready on loopback. Host fingerprint: " + fingerprint,
  );
  relay = createRelay(config, "far");
  const status = {
    capabilities: {
      nodeExecutable: process.execPath,
      nodeMode: process.versions.electron ? "electron" : "node",
      exec: true,
      sftp: true,
      shell: true,
      pty: false,
      forwarding: "loopback-only",
      reliableRelay: true,
      version: 3,
    },
    fingerprint,
    platform: process.platform,
    user: config.user,
    hostname: os.hostname(),
    permissions: executionContext,
  };
  relay.on("ready", () => {
    console.log(
      "Public encrypted relay subscribed; waiting for near-end verification.",
    );
    relay.status(status).catch(() => {});
  });
  relay.on("peer", () => relay.status(status).catch(() => {}));
  relay.on("offline", () =>
    console.log("Public relay disconnected; reconnecting."),
  );
  relay.on("diagnostic", (message) => console.error("Relay:", message));
  relay.on("trace", (entry) => {
    recordTrace(entry);
    console.error("RELAY_TRACE " + JSON.stringify(entry));
  });
  heartbeat = setInterval(() => relay.status(status).catch(() => {}), 15e3);
});
function close() {
  clearInterval(heartbeat);
  if (relay) relay.close();
  for (const child of children) child.terminate();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2e3).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
