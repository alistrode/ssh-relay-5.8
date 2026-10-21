import net from "node:net";
import fs from "node:fs";
import { createRequire } from "node:module";
import { statePath } from "./state.js";
import { servers } from "./config.js";
const require = createRequire(import.meta.url);
const { durableWrite, privateJSON } = require("../pro/task-store.cjs");
const { folder } = require("../pro/store.cjs");
function savedFile(id) {
  if (!/^tunnel_[a-f0-9-]{36}$/.test(id)) throw Error("Invalid tunnel ID");
  return statePath("tunnel-records") + "/" + id + ".json";
}
function save(t, desired = true) {
  if (!t.deviceId) return;
  folder(statePath("tunnel-records"));
  durableWrite(savedFile(t.id), { id: t.id, deviceId: t.deviceId, desired, spec: t.spec });
}
function recover(t) {
  if (t.closed || t.recoveryTimer || tunnels.get(t.id) !== t) return;
  t.recoveryTimer = setTimeout(async () => {
    t.recoveryTimer = null;
    if (t.closed || tunnels.get(t.id) !== t) return;
    try { await createTunnel(t.spec, { id: t.id, deviceId: t.deviceId, original: t }); }
    catch { if (!t.closed) { t.state = "waiting"; recover(t); } }
  }, 5000);
  t.recoveryTimer.unref();
}
async function release(t) {
  for (const socket of t.sockets) socket.destroy();
  if (t.listener?.listening) await new Promise(resolve => t.listener.close(resolve));
  t.client?.removeListener("close", t.onClose);
  if (t.handler) t.client?.removeListener("tcp connection", t.handler);
}
import { randomUUID } from "node:crypto";
import { connect } from "./transport.js";
const loopback = (h) => ["127.0.0.1", "localhost", "::1"].includes(h);
export const tunnels = new Map();
const bind = (s, port, host) =>
  new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(port, host, () => {
      s.removeListener("error", reject);
      s.on("error", () => {});
      resolve();
    });
  });
export async function createTunnel(a, recovery = null) {
  const localHost = a.localHost || "127.0.0.1";
  if (!loopback(localHost))
    throw new Error("LAN bindings excluded: use loopback localHost");
  if (!Number.isInteger(a.localPort) || a.localPort < 1 || a.localPort > 65535)
    throw new Error("Invalid local port");
  if (
    a.type !== "dynamic" &&
    (!loopback(a.remoteHost) ||
      !Number.isInteger(a.remotePort) ||
      a.remotePort < 1 ||
      a.remotePort > 65535)
  )
    throw new Error(
      "Only loopback remote services are supported; specify remoteHost and remotePort",
    );
  const conn = await connect(a.server);
  if (recovery && (conn.config.agentDeviceId !== recovery.deviceId || recovery.original.closed || tunnels.get(recovery.id) !== recovery.original))
    throw Error("Saved tunnel target changed or was closed");
  if (conn.config.capabilities.forwarding !== "loopback-only")
    throw new Error(
      "Remote version lacks forwarding; restart the updated remote source before creating tunnels",
    );
  const id = recovery?.id || "tunnel_" + randomUUID(),
    t = {
      id,
      deviceId: conn.config.agentDeviceId,
      spec: { server: conn.config.name, type: a.type, localHost, localPort: a.localPort,
        remoteHost: a.remoteHost, remotePort: a.remotePort },
      server: conn.config.name,
      type: a.type,
      localHost,
      localPort: a.localPort,
      remoteHost: a.remoteHost,
      remotePort: a.remotePort,
      state: "starting",
      sockets: new Set(),
      listener: null,
      handler: null,
      client: conn.client,
    };
  const track = (s) => {
    t.sockets.add(s);
    s.on("error", () => s.destroy());
    s.on("close", () => t.sockets.delete(s));
    return s;
  };
  const forward = (
    socket,
    host,
    port,
    rest = Buffer.alloc(0),
    socks = false,
  ) => {
    conn.client.forwardOut("127.0.0.1", 0, host, port, (e, ch) => {
      if (e) {
        if (socks) socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
        else socket.destroy();
        return;
      }
      track(ch);
      if (socks) socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
      if (rest.length) ch.write(rest);
      socket.pipe(ch).pipe(socket);
      socket.resume();
      socket.on("close", () => ch.destroy());
      ch.on("close", () => socket.destroy());
    });
  };
  if (a.type === "remote") {
    t.handler = (info, accept, reject) => {
      if (info.destPort !== a.remotePort || !loopback(info.destIP)) return;
      const socket = track(net.connect(a.localPort, localHost));
      socket.once("connect", () => {
        const ch = track(accept());
        socket.pipe(ch).pipe(socket);
        socket.on("close", () => ch.destroy());
        ch.on("close", () => socket.destroy());
      });
      socket.once("error", () => reject());
    };
    conn.client.on("tcp connection", t.handler);
    try {
      await new Promise((res, rej) =>
        conn.client.forwardIn(a.remoteHost, a.remotePort, (e) =>
          e ? rej(e) : res(),
        ),
      );
    } catch (e) {
      conn.client.removeListener("tcp connection", t.handler);
      throw e;
    }
  } else {
    t.listener = net.createServer((socket) => {
      track(socket);
      if (a.type === "local")
        return forward(socket, a.remoteHost, a.remotePort);
      let buffer = Buffer.alloc(0),
        stage = 0;
      const timer = setTimeout(() => socket.destroy(), 10000);
      socket.once("close", () => clearTimeout(timer));
      const consume = (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length > 4096) {
          socket.destroy();
          return;
        }
        if (stage === 0) {
          if (buffer.length < 2) return;
          const n = buffer[1];
          if (buffer.length < 2 + n) return;
          if (buffer[0] !== 5 || !buffer.subarray(2, 2 + n).includes(0)) {
            socket.end(Buffer.from([5, 255]));
            return;
          }
          socket.write(Buffer.from([5, 0]));
          buffer = buffer.subarray(2 + n);
          stage = 1;
        }
        if (stage === 1) {
          if (buffer.length < 4) return;
          if (buffer[0] !== 5 || buffer[1] !== 1) return socket.destroy();
          let host, offset;
          if (buffer[3] === 1) {
            if (buffer.length < 10) return;
            host = [...buffer.subarray(4, 8)].join(".");
            offset = 8;
          } else if (buffer[3] === 3) {
            if (buffer.length < 5 || buffer.length < 7 + buffer[4]) return;
            host = buffer.subarray(5, 5 + buffer[4]).toString();
            offset = 5 + buffer[4];
          } else return socket.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]));
          const port = buffer.readUInt16BE(offset);
          if (!loopback(host))
            return socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
          stage = 2;
          clearTimeout(timer);
          socket.pause();
          socket.removeListener("data", consume);
          forward(socket, host, port, buffer.subarray(offset + 2), true);
        }
      };
      socket.on("data", consume);
    });
    await bind(t.listener, a.localPort, localHost);
  }
  if (recovery && (recovery.original.closed || tunnels.get(id) !== recovery.original)) {
    await release(t); throw Error("Tunnel was closed during recovery");
  }
  t.state = "active";
  t.onClose = () => {
    if (t.closed) return;
    t.state = "waiting";
    release(t).then(() => {
      if (t.deviceId) recover(t);
      else closeTunnel(id).catch(() => {});
    }).catch(() => { t.state = "unknown"; });
  };
  conn.client.once("close", t.onClose);
  tunnels.set(id, t);
  try { save(t); }
  catch (error) { await closeTunnel(id).catch(() => {}); throw error; }
  return tunnelInfo(t);
}
export const tunnelInfo = (t) => ({
  id: t.id,
  server: t.server,
  type: t.type,
  state: t.state,
  localHost: t.localHost,
  localPort: t.localPort,
  remoteHost: t.remoteHost,
  remotePort: t.remotePort,
  connections: t.sockets.size,
  scope: "loopback-only",
  persistent: !!t.deviceId,
  recovery: t.deviceId ? "recreate-listener-only" : "legacy-ssh-channel",
});
export async function closeTunnel(id, { remember = false } = {}) {
  const t = tunnels.get(id);
  if (!t) throw new Error("Unknown tunnel");
  t.closed = true; clearTimeout(t.recoveryTimer);
  save(t, remember);
  tunnels.delete(id);
  t.state = "closed";
  for (const s of t.sockets) s.destroy();
  if (t.listener) t.listener.close();
  if (t.handler) {
    t.client?.removeListener("tcp connection", t.handler);
    if (t.client?._sock && !t.client._sock.destroyed)
      await new Promise((resolve) =>
        t.client.unforwardIn(t.remoteHost, t.remotePort, () => resolve()),
      );
  }
  t.client?.removeListener("close", t.onClose);
  return { id, closed: true };
}


export function restoreTunnels() {
  const dir = folder(statePath("tunnel-records")), configs = Object.values(servers());
  for (const name of fs.readdirSync(dir)) {
    if (!/^tunnel_[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const r = privateJSON(dir + "/" + name);
      if (!r.desired || r.id + ".json" !== name || tunnels.has(r.id)) continue;
      const target = configs.find(c => c.agentDeviceId === r.deviceId);
      if (!target) continue;
      const t = { ...r.spec, id: r.id, deviceId: r.deviceId, server: target.name,
        spec: { ...r.spec, server: target.name }, state: "waiting", sockets: new Set() };
      tunnels.set(t.id, t); recover(t);
    } catch {}
  }
}
