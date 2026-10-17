"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { Client } = require("ssh2");
const report = JSON.parse(fs.readFileSync(process.argv[2])),
  out = process.argv[3],
  results = [],
  farLog = process.argv[4];
if (!farLog)
  throw Error(
    "Provide the isolated far agent log to verify connection cleanup",
  );
async function probe(round, index) {
  return new Promise((resolve) => {
    const client = new Client(),
      start = Date.now(),
      nonce = crypto.randomBytes(8).toString("hex");
    let settled = false;
    const finish = (error, code, text) => {
      if (settled) return;
      settled = true;
      client.destroy();
      const row = {
        round,
        index,
        ms: Date.now() - start,
        passed:
          !error &&
          code === 0 &&
          new RegExp("^" + nonce + ":[0-9]+$").test(text),
        remotePid: text?.startsWith(nonce + ":")
          ? Number(text.slice(nonce.length + 1))
          : undefined,
        error: error?.message,
      };
      results.push(row);
      fs.writeFileSync(out, JSON.stringify(results, null, 2));
      resolve(row);
    };
    client.on("error", (e) => finish(e));
    client.on("close", () => finish(Error("Closed before complete result")));
    client.on("ready", () =>
      client.exec("printf '%s:%s' " + nonce + ' "$$"', (error, stream) => {
        if (error) return finish(error);
        let text = "",
          code;
        stream.on("data", (d) => (text += d));
        stream.on("exit", (n) => (code = n));
        stream.on("close", () =>
          finish(code === 0 ? null : Error("Exit was not zero"), code, text),
        );
      }),
    );
    client.connect({
      host: "127.0.0.1",
      port: report.local_port,
      username: "relay",
      privateKey: fs.readFileSync(
        path.join(report.state_directory, "client_key"),
      ),
      readyTimeout: 45000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      hostVerifier: (key) =>
        "SHA256:" +
          crypto
            .createHash("sha256")
            .update(key)
            .digest("base64")
            .replace(/=+$/, "") ===
        report.host_fingerprint,
    });
  });
}
async function waitForFarClosure(rows) {
  const pids = new Set(rows.map((x) => x.remotePid));
  for (let attempt = 0; attempt < 120; attempt++) {
    const ids = new Set(),
      closed = new Set();
    for (const name of [farLog + ".3", farLog + ".2", farLog + ".1", farLog]) {
      if (!fs.existsSync(name)) continue;
      for (const line of fs.readFileSync(name, "utf8").split("\n")) {
        try {
          const item = JSON.parse(line),
            e = item.trace || item;
          if (e.event === "ssh_process_start" && pids.has(e.pid))
            ids.add(e.sshId);
          if (e.event === "ssh_close") closed.add(e.sshId);
        } catch {}
      }
    }
    if (ids.size === pids.size && [...ids].every((id) => closed.has(id)))
      return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Far did not confirm closure of the previous owned SDK batch");
}
(async () => {
  for (let round = 0; round < 8; round++) {
    const rows = await Promise.all(
      Array.from({ length: 4 }, (_, i) => probe(round, i)),
    );
    if (rows.some((x) => !x.passed))
      throw Error("A raw SDK connection failed; no retry was attempted");
    await waitForFarClosure(rows);
    console.log(
      "Round",
      round + 1,
      "completed; failures",
      results.filter((x) => !x.passed).length,
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  if (results.some((x) => !x.passed)) process.exitCode = 1;
  else console.log("PUBLIC CLIENTS PASS 32/32; zero retries");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
