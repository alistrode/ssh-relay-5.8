"use strict";
const mqtt = require("mqtt"),
  crypto = require("node:crypto"),
  { HttpsProxyAgent } = require("https-proxy-agent"),
  opaque = require("@serenity-kit/opaque"),
  { utils } = require("ssh2");
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const { proxyForWebSocket } = require("./network.cjs");
function random(n) {
  return Array.from(
    crypto.randomBytes(n),
    (b) => ALPHABET[b % ALPHABET.length],
  ).join("");
}
function connect(broker) {
  const proxy = proxyForWebSocket(broker);
  return mqtt.connect(broker, {
    clientId: "relay-pro-pair-" + crypto.randomBytes(12).toString("hex"),
    clean: true,
    keepalive: 20,
    reconnectPeriod: 2000,
    connectTimeout: 15000,
    wsOptions: proxy ? { agent: new HttpsProxyAgent(proxy) } : {},
  });
}
function seal(key, value, aad) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv(
      "aes-256-gcm",
      crypto
        .createHash("sha256")
        .update(key + aad)
        .digest(),
      iv,
    );
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return {
    iv: iv.toString("base64"),
    data: data.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
  };
}
function open(key, value, aad) {
  if (!value || typeof value.data !== "string" || value.data.length > 20000)
    throw Error("Invalid pairing envelope");
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    crypto
      .createHash("sha256")
      .update(key + aad)
      .digest(),
    Buffer.from(value.iv, "base64"),
  );
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(value.data, "base64")),
      d.final(),
    ]).toString(),
  );
}
async function offer({ broker, info, authorize, log, ttl = 24 * 60 * 60 * 1000, reusable = false }) {
  await opaque.ready;
  const room = random(10),
    password = random(10),
    code = room + "-" + password,
    topic = "ssh-public-relay/pro-pair/v1/" + room,
    setup = opaque.server.createSetup();
  const reg = opaque.client.startRegistration({ password });
  const response = opaque.server.createRegistrationResponse({
    serverSetup: setup,
    userIdentifier: room,
    registrationRequest: reg.registrationRequest,
  });
  const { registrationRecord } = opaque.client.finishRegistration({
    ...reg,
    ...response,
    password,
  });
  const client = connect(broker),
    attempts = new Map();
  let consumed = null,
    closed = false,
    receiptTimer;
  const send = (p) => {
    if (!closed)
      client.publish(
        topic,
        JSON.stringify({ ...p, side: "far" }),
        { qos: 1 },
        () => {},
      );
  };
  const cancel = () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(receiptTimer);
    client.end(true);
  };
  const expiresAt = Date.now() + ttl,
    timer = setTimeout(cancel, ttl);
  timer.unref();
  client.on("error", () => log?.("pair_broker_error"));
  client.on("connect", () => client.subscribe(topic, { qos: 1 }));
  client.on("message", async (_, raw) => {
    if (closed || raw.length > 30000 || Date.now() > expiresAt) return;
    try {
      const p = JSON.parse(raw);
      if (p.side !== "near" || !/^\w{32}$/.test(p.sid)) return;
      if (p.type === "hello") {
        if (!reusable && consumed && consumed !== p.sid) return;
        if (!attempts.has(p.sid)) {
          for (const [sid, entry] of attempts) {
            if (!entry.busy && Date.now() - entry.createdAt > 120000) attempts.delete(sid);
          }
          if (attempts.size >= 128) return;
          const login = opaque.server.startLogin({
            serverSetup: setup,
            registrationRecord,
            userIdentifier: room,
            startLoginRequest: p.request,
          });
          attempts.set(p.sid, { login, createdAt: Date.now() });
        }
        send({
          type: "challenge",
          sid: p.sid,
          response: attempts.get(p.sid).login.loginResponse,
        });
      } else if (p.type === "finish") {
        const entry = attempts.get(p.sid);
        if (
          !entry ||
          entry.failed ||
          entry.busy ||
          (!reusable && consumed && consumed !== p.sid)
        )
          return;
        if (entry.answer) {
          send({ type: "paired", sid: p.sid, envelope: entry.answer });
          return;
        }
        entry.busy = true;
        try {
          const { sessionKey } = opaque.server.finishLogin({
            serverLoginState: entry.login.serverLoginState,
            finishLoginRequest: p.finish,
          });
          const who = open(
            sessionKey,
            p.envelope,
            "near:" + room + ":" + p.sid,
          );
          if (
            !/^[a-f0-9-]{36}$/.test(who.deviceId) ||
            typeof who.publicKey !== "string"
          )
            throw Error("Invalid device identity");
          const key = utils.parseKey(who.publicKey);
          if (key instanceof Error || key.type !== "ssh-ed25519")
            throw Error("Invalid device key");
          if (!reusable && consumed && consumed !== p.sid) return;
          if (!reusable) consumed = p.sid;
          const assigned = await authorize(who);
          entry.key = sessionKey;
          entry.answer = seal(sessionKey, assigned || info, "far:" + room + ":" + p.sid);
          send({ type: "paired", sid: p.sid, envelope: entry.answer });
          log?.("pair_authorized", { deviceId: who.deviceId });
        } catch {
          entry.failed = true;
          log?.("pair_attempt_failed");
        } finally {
          entry.busy = false;
        }
      } else if (p.type === "receipt") {
        const entry = attempts.get(p.sid);
        if (entry?.key) {
          const v = open(
            entry.key,
            p.envelope,
            "receipt:" + room + ":" + p.sid,
          );
          if (!reusable && v.deviceId === info.deviceId) {
            receiptTimer = setTimeout(cancel, 3000);
            receiptTimer.unref();
          }
        }
      }
    } catch {
      log?.("pair_invalid_message");
    }
  });
  return {
    code,
    expiresAt,
    cancel,
    get active() {
      return !closed;
    },
  };
}
async function join({ broker, code, who, accept, timeout = 90000 }) {
  await opaque.ready;
  code = String(code).toUpperCase().replace(/\s/g, "");
  if (!new RegExp("^[" + ALPHABET + "]{10}-[" + ALPHABET + "]{10}$").test(code))
    throw Error("Invalid pairing code format");
  const [room, password] = code.split("-"),
    topic = "ssh-public-relay/pro-pair/v1/" + room,
    sid = crypto.randomBytes(16).toString("hex");
  const start = opaque.client.startLogin({ password }),
    client = connect(broker);
  let final = null,
    done = false,
    busy = false;
  return new Promise((resolve, reject) => {
    const send = () => {
      if (done) return;
      const p = final
        ? { type: final.type, finish: final.finish, envelope: final.envelope }
        : { type: "hello", request: start.startLoginRequest };
      client.publish(
        topic,
        JSON.stringify({ ...p, sid, side: "near" }),
        { qos: 1 },
        () => {},
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(retry);
      client.end(true);
    };
    const timer = setTimeout(() => {
        done = true;
        cleanup();
        reject(
          Error("Pairing timed out; code may have expired or be incorrect"),
        );
      }, timeout),
      retry = setInterval(send, 1500);
    client.on("error", () => {});
    client.on("connect", () =>
      client.subscribe(topic, { qos: 1 }, () => send()),
    );
    client.on("message", async (_, raw) => {
      if (done || raw.length > 30000) return;
      try {
        const p = JSON.parse(raw);
        if (p.side !== "far" || p.sid !== sid) return;
        if (p.type === "challenge" && !final) {
          const login = opaque.client.finishLogin({
            clientLoginState: start.clientLoginState,
            loginResponse: p.response,
            password,
          });
          if (!login) throw Error("Pairing authentication failed");
          final = {
            type: "finish",
            finish: login.finishLoginRequest,
            envelope: seal(login.sessionKey, who, "near:" + room + ":" + sid),
            key: login.sessionKey,
          };
          send();
        }
        if (p.type === "paired" && final && !busy) {
          busy = true;
          const info = open(final.key, p.envelope, "far:" + room + ":" + sid);
          await accept(info);
          done = true;
          clearTimeout(timer);
          clearInterval(retry);
          client.publish(
            topic,
            JSON.stringify({
              type: "receipt",
              side: "near",
              sid,
              envelope: seal(
                final.key,
                { deviceId: info.deviceId },
                "receipt:" + room + ":" + sid,
              ),
            }),
            { qos: 1 },
            () => {
              client.end(true);
              resolve(info);
            },
          );
          setTimeout(() => {
            client.end(true);
            resolve(info);
          }, 2000).unref();
        }
      } catch (e) {
        done = true;
        cleanup();
        reject(Error("Pairing authentication or target verification failed"));
      }
    });
  });
}
module.exports = { offer, join };
