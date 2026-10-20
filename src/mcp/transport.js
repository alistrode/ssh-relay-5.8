import { Client } from "ssh2";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { serverConfig, refreshAgentServers } from "./config.js";
import { readState } from "./state.js";
import { shellQuote } from "./shell-quote.js";
export const pool = new Map();
const pending = new Map();
const recovery = new Map();
let shuttingDown = false;
export function recoverManaged(config) {
  if (!config.agentManaged || shuttingDown || recovery.has(config.name)) return;
  const controller = { cancelled: false };
  recovery.set(config.name, controller);
  (async () => {
    let failures = 0;
    while (!controller.cancelled && !shuttingDown) {
      try {
        await connect(config.name, 0);
        break;
      } catch (error) {
        if (
          /revoked|host key|verification|differs|authentication methods failed/i.test(
            error.message,
          )
        )
          break;
        failures++;
        const delay =
          failures < 3
            ? 0
            : [2000, 4000, 8000, 16000, 30000, 60000][
                Math.min(failures - 3, 5)
              ];
        console.error(
          JSON.stringify({
            event: "mcp_reconnect",
            server: config.name,
            attempt: failures,
            delayMs: delay,
          }),
        );
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref();
        });
      }
    }
    if (recovery.get(config.name) === controller) recovery.delete(config.name);
  })().catch(() => recovery.delete(config.name));
}
export const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
export function powershell(script) {
  const prelude =
    "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$global:LASTEXITCODE=0;";
  const body =
    prelude +
    "try {" +
    script +
    "\n;if($LASTEXITCODE){exit $LASTEXITCODE}} catch {[Console]::Error.WriteLine($_.Exception.Message);exit 1}";
  // CMD has an 8191-character ceiling; compress larger scripts without uploading files.
  const packed = zlib.gzipSync(Buffer.from(body)).toString("base64");
  const wrapper = `$m=[IO.MemoryStream]::new([Convert]::FromBase64String('${packed}'));$g=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress);$r=[IO.StreamReader]::new($g);& ([scriptblock]::Create($r.ReadToEnd()))`;
  const cmd =
    "powershell -NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand " +
    Buffer.from(wrapper, "utf16le").toString("base64");
  if (cmd.length > 7800)
    throw new Error(
      "PowerShell command too large for CMD; upload a script and execute its verified path",
    );
  return cmd;
}
export async function connect(name, retries = 2) {
  await refreshAgentServers();
  const config = serverConfig(name);
  const key = config.name;
  if (readState("revoked-keys.json", {})[key])
    throw new Error("Application host key pin revoked");
  const old = pool.get(key);
  if (
    old?.connected &&
    old.config.fingerprint === config.fingerprint &&
    old.config.port === config.port
  )
    return old;
  if (old) old.close();
  if (pending.has(key)) return pending.get(key);
  const task = new Promise((resolve, reject) => {
    const client = new Client();
    const conn = {
      client,
      config,
      connected: false,
      sftp: null,
      close() {
        this.manualClose = true;
        const task = recovery.get(key);
        if (task) task.cancelled = true;
        this.connected = false;
        client.end();
        pool.delete(key);
      },
    };
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("SSH connection/identity check timeout"));
    }, 65000);
    client.on("error", (err) => {
      conn.connected = false;
      clearTimeout(timer);
      reject(err);
    });
    client.on("close", () => {
      conn.connected = false;
      if (pool.get(key) === conn) pool.delete(key);
      if (conn.verified && !conn.manualClose)
        setImmediate(() => recoverManaged(config));
    });
    client.once("ready", async () => {
      conn.connected = true;
      try {
        const result = await executeRaw(
          conn,
          config.platform === "windows"
            ? "whoami & hostname"
            : "whoami; hostname",
          { timeout: 15000 },
        );
        const lines = result.stdout
          .trim()
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (result.code !== 0)
          throw new Error("Identity probe failed or incomplete");
        if (
          lines.at(-1)?.toLowerCase() !== config.hostname.toLowerCase() ||
          lines[0]?.toLowerCase() !== config.remoteUser.toLowerCase()
        )
          throw new Error(
            "Actual SSH account or hostname differs from verified connection report",
          );
        conn.verified = true;
        pool.set(key, conn);
        clearTimeout(timer);
        resolve(conn);
      } catch (e) {
        clearTimeout(timer);
        conn.close();
        reject(e);
      }
    });
    client.connect({
      host: "127.0.0.1",
      port: config.port,
      username: "relay",
      privateKey: fs.readFileSync(config.keyPath),
      readyTimeout: 45000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      hostVerifier: (key) => {
        const actual =
          "SHA256:" +
          crypto
            .createHash("sha256")
            .update(key)
            .digest("base64")
            .replace(/=+$/, "");
        return (
          actual.length === config.fingerprint.length &&
          crypto.timingSafeEqual(
            Buffer.from(actual),
            Buffer.from(config.fingerprint),
          )
        );
      },
    });
  });
  pending.set(key, task);
  try {
    return await task;
  } catch (error) {
    // Only connection establishment and its read-only identity probe can retry.
    // User commands, uploads, imports and deployments are never replayed here.
    if (
      retries > 0 &&
      /timed? out|timeout|ECONNRESET|ECONNREFUSED|handshake|Identity probe failed/i.test(
        error.message,
      ) &&
      !/host key|verification/i.test(error.message)
    ) {
      if (pending.get(key) === task) pending.delete(key);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return connect(name, retries - 1);
    }
    throw error;
  } finally {
    if (pending.get(key) === task) pending.delete(key);
  }
}
export function executeRaw(
  conn,
  command,
  { timeout = 30000, stdin = null, maxOutput = 2 * 1024 * 1024 } = {},
) {
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000)
    throw new Error("Timeout must be 1..300000 ms");
  return new Promise((resolve, reject) => {
    let stream,
      done = false,
      out = [],
      err = [],
      size = 0,
      code = null,
      signal = null;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        stream?.close();
        reject(error);
      } else
        resolve({
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          code,
          signal,
          success: code === 0,
        });
    };
    const timer = setTimeout(() => {
      stream?.signal("TERM");
      finish(
        new Error(
          `Command timed out after ${timeout}ms; interrupted task is not resumable`,
        ),
      );
    }, timeout);
    conn.client.exec(command, (error, ch) => {
      if (error) return finish(error);
      stream = ch;
      if (done) {
        ch.close();
        return;
      }
      const append = (target, data) => {
        size += data.length;
        if (size > maxOutput)
          return finish(
            new Error(
              "Command output exceeded 2 MiB; redirect output to a remote file and download it",
            ),
          );
        target.push(data);
      };
      ch.on("data", (d) => append(out, d));
      ch.stderr.on("data", (d) => append(err, d));
      ch.on("exit", (status, sig) => {
        code = Number.isInteger(status) ? status : null;
        signal = sig || null;
      });
      ch.on("close", (status, sig) => {
        if (code === null && Number.isInteger(status)) code = status;
        if (!signal && sig) signal = sig;
        finish();
      });
      ch.on("error", finish);
      if (stdin !== null) ch.end(stdin);
      else ch.end();
    });
  });
}
export async function run(
  name,
  command,
  { cwd, timeout = 120000, raw = false, stdin = null } = {},
) {
  const conn = await connect(name);
  const win = conn.config.platform === "windows";
  let script = command;
  if (cwd)
    script = win
      ? `Set-Location -LiteralPath ${psQuote(cwd)};\n${script}`
      : `cd -- ${shellQuote(cwd)} && ${script}`;
  return executeRaw(conn, win && !raw ? powershell(script) : script, {
    timeout,
    stdin,
  });
}
export async function sftp(name) {
  const conn = await connect(name);
  if (conn.sftp) return conn.sftp;
  conn.sftp = await new Promise((res, rej) =>
    conn.client.sftp((e, s) => (e ? rej(e) : res(s))),
  );
  return conn.sftp;
}
export const sftpCall = (s, method, ...args) =>
  new Promise((resolve, reject) =>
    s[method](...args, (e, value) => (e ? reject(e) : resolve(value))),
  );
export function closeAll() {
  shuttingDown = true;
  for (const task of recovery.values()) task.cancelled = true;
  for (const conn of [...pool.values()]) conn.close();
}
