import { randomUUID } from "node:crypto";
import { connect } from "./transport.js";
export const sessions = new Map();
export async function startSession(name, label) {
  const conn = await connect(name),
    id = "ssh_" + randomUUID();
  const windows = conn.config.platform === "windows";
  const command = windows
    ? "powershell -NoLogo -NoProfile -NonInteractive -OutputFormat Text -Command -"
    : "/bin/sh -s";
  const stream = await new Promise((resolve, reject) =>
    conn.client.exec(command, (e, s) => (e ? reject(e) : resolve(s))),
  );
  const session = {
    id,
    server: conn.config.name,
    name: label || name,
    windows,
    stream,
    state: "ready",
    cwd: null,
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
    history: [],
    pending: null,
    buffer: "",
    error: "",
  };
  stream.on("data", (data) => {
    session.buffer += data.toString("utf8");
    const p = session.pending;
    if (session.buffer.length > 2 * 1024 * 1024) {
      p?.reject(new Error("Session output exceeded 2 MiB"));
      stream.close();
      return;
    }
    if (!p) return;
    const re = new RegExp(
      "(?:^|\\r?\\n)" + p.marker + ":(\\d+):([^\\r\\n]*)\\r?\\n",
    );
    const match = re.exec(session.buffer);
    if (!match) return;
    const stdout = session.buffer.slice(0, match.index).replace(/\r?\n$/, "");
    session.buffer = session.buffer.slice(match.index + match[0].length);
    const code = Number(match[1]);
    session.cwd = Buffer.from(match[2], "base64").toString("utf8").trim();
    const result = {
      stdout,
      stderr: session.error,
      code,
      success: code === 0,
      cwd: session.cwd,
      session: id,
    };
    session.pending = null;
    session.state = "ready";
    session.lastActivity = Date.now();
    clearTimeout(p.timer);
    p.resolve(result);
  });
  stream.stderr.on("data", (d) => {
    session.error += d.toString("utf8");
  });
  const closed = () => {
    session.state = "closed";
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(
        new Error("Persistent shell disconnected; state cannot be resumed"),
      );
      session.pending = null;
    }
  };
  stream.on("close", closed);
  stream.on("error", closed);
  sessions.set(id, session);
  try {
    await sendSession(
      id,
      windows
        ? "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)"
        : "true",
      15000,
      false,
    );
    return sessionInfo(session);
  } catch (e) {
    closeSession(id);
    throw e;
  }
}
export function sessionInfo(s) {
  return {
    id: s.id,
    server: s.server,
    name: s.name,
    state: s.state,
    cwd: s.cwd,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    historyCount: s.history.length,
    platform: s.windows ? "windows" : "linux",
  };
}
export function sendSession(id, command, timeout = 30000, record = true) {
  const s = sessions.get(id);
  if (!s || s.state === "closed")
    throw new Error("Session missing or closed; start a new session");
  if (s.state !== "ready") throw new Error("Session is busy");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000)
    throw new Error("Timeout must be 1..300000 ms");
  s.state = "busy";
  s.buffer = "";
  s.error = "";
  const marker = "MCP_" + randomUUID().replaceAll("-", "");
  const encoded = Buffer.from(command, "utf8").toString("base64");
  const script = s.windows
    ? `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';$global:LASTEXITCODE=0;try {. ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))));$__mcpCode=if($?){if($LASTEXITCODE){$LASTEXITCODE}else{0}}else{1}}catch{[Console]::Error.WriteLine($_.Exception.Message);$__mcpCode=1};[Console]::WriteLine(('${marker}:'+ $__mcpCode+':'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))))\n`
    : `eval '${command.replaceAll("'", "'\\''")}'\n__mcp_code=$?\nprintf '\\n${marker}:%s:%s\\n' "$__mcp_code" "$(pwd | base64 | tr -d '\\n')"\n`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending = null;
      s.state = "closed";
      s.stream.signal("TERM");
      s.stream.close();
      reject(
        new Error(
          "Session command timeout; shell closed to avoid reusing uncertain state",
        ),
      );
    }, timeout);
    s.pending = { marker, resolve, reject, timer };
    if (record)
      s.history.push({ command, timestamp: new Date().toISOString() });
    s.stream.write(script);
  });
}
export function closeSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown session");
  s.stream.end("exit\n");
  s.stream.close();
  sessions.delete(id);
  return { id, closed: true };
}
export function closeSessions() {
  for (const id of [...sessions.keys()]) closeSession(id);
}
