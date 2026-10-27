"use strict";
const mqtt = require("mqtt");
const { HttpsProxyAgent } = require("https-proxy-agent");
const crypto = require("node:crypto");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const { proxyForWebSocket } = require("./pro/network.cjs");
const { ClockProof } = require("./pro/clock-proof.cjs");

// QoS 1 confirms receipt by the broker, not delivery to our opposite endpoint.
// Version 2 retains stream frames until that endpoint acknowledges them.
const CHUNK = 16384;
const WINDOW = 4;
const RECEIVE_WINDOW = 32;
const DELIVERY_TIMEOUT = 30000;
const CLOSED_CACHE_MS = 45000;
function createRelay(config, role) {
  if (
    !/^[a-f0-9]{32}$/.test(config.session) ||
    !/^[a-f0-9]{64}$/.test(config.secret)
  )
    throw new Error("Invalid session configuration");
  const events = new EventEmitter();
  const opposite = role === "near" ? "far" : "near";
  const prefix = `ssh-relay/5.7/${config.session}/`;
  const proxy = proxyForWebSocket(config.broker);
  const client = mqtt.connect(config.broker, {
    clientId: `ssh-${role}-${crypto.randomBytes(10).toString("hex")}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: config.reconnectPolicy ? 0 : 3000,
    connectTimeout: 15000,
    queueQoSZero: false,
    wsOptions: proxy ? { agent: new HttpsProxyAgent(proxy) } : {},
  });
  const instance = crypto.randomBytes(8).toString("hex");
  const clock = config.clockSkewCorrection ? new ClockProof() : null;
  let lastClockProbe = -Infinity, lastStatus, peerSwitchedAt = -Infinity;
  const retiredPeers = new Set();
  function clockProbe() {
    if (!clock || !ready || performance.now()-lastClockProbe<1000) return;
    lastClockProbe=performance.now();control({type:"clock_probe",nonce:clock.begin()});
  }
  const connections = new Map();
  const closed = new Map();
  let brokerFailures = 0,
    reconnectTimer = null;
  let epoch = 0,
    lastPeerStatus = 0;
  let ready = false,
    stopping = false,
    peerProtocol = 57,
    peerInstance;
  const stats = {
    opened: 0,
    closed: 0,
    retransmitted: 0,
    duplicates: 0,
    reordered: 0,
    deliveryTimeouts: 0,
    rejected: 0,
  };
  function trace(event, state, details = {}) {
    events.emit("trace", {
      time: new Date().toISOString(),
      role,
      event,
      ...(state
        ? {
            cid: state.cid,
            protocol: 57,
            opened: state.opened,
            sent: state.out,
            received: state.incoming,
            ageMs: Date.now() - state.createdAt,
            localPort: state.socket.localPort,
            remotePort: state.socket.remotePort,
            txBytes: state.txBytes,
            rxBytes: state.rxBytes,
            pending: state.tx.size,
          }
        : {}),
      connections: connections.size,
      ...details,
    });
  }
  const sign = (body) =>
    crypto
      .createHmac("sha256", Buffer.from(config.secret, "hex"))
      .update(body)
      .digest();
  const wireData = [],
    wireControl = [],
    wireJobs = new Map(),
    pendingResets = new Map();
  let wireTimer = null,
    lastWire = 0,
    controlTurn = true;
  const wireInterval = 100;
  function pumpWire() {
    if (wireTimer) return;
    if (!ready) {
      for (const job of [...wireData, ...wireControl])
        job.reject(new Error("Public relay is offline"));
      wireData.length = 0;
      wireControl.length = 0;
      wireJobs.clear();
      return;
    }
    const remaining = wireInterval - (Date.now() - lastWire);
    if (remaining > 0) {
      wireTimer = setTimeout(() => {
        wireTimer = null;
        pumpWire();
      }, remaining);
      wireTimer.unref();
      return;
    }
    let job;
    while (wireData.length || wireControl.length) {
      const queue =
        wireControl.length && (!wireData.length || controlTurn)
          ? wireControl
          : wireData;
      controlTurn = !controlTurn;
      job = queue.shift();
      wireJobs.delete(job.key);
      if (job.valid && !job.valid()) {
        job.resolve();
        job = null;
        continue;
      }
      break;
    }
    if (!job) return;
    lastWire = Date.now();
    const sentAt = lastWire;
    const frame = job.frame;
    const body = JSON.stringify({
      ...frame,
      time: Date.now(),
      role,
      applicationRelease: "5.7",
      protocol: 57,
      relayEpoch: instance + ":" + epoch,
    });
    const packet = JSON.stringify({ body, mac: sign(body).toString("base64") });
    if (config.traceFrames)
      trace("publish_packet", null, {
        cid: frame.cid,
        seq: frame.seq,
        type: frame.type,
        bytes: Buffer.byteLength(packet),
        digest: crypto
          .createHash("sha256")
          .update(packet)
          .digest("hex")
          .slice(0, 16),
      });
    job.onSent?.();
    try {
      client.publish(
        prefix + opposite,
        packet,
        { qos: 1, retain: false },
        (error) => {
          if (config.traceFrames || error)
            trace("broker_ack", null, {
              cid: frame.cid,
              seq: frame.seq,
              type: frame.type,
              latencyMs: Date.now() - sentAt,
              error: error?.message,
            });
          error ? job.reject(error) : job.resolve();
        },
      );
    } catch (error) {
      job.reject(error);
    }
    if (wireData.length || wireControl.length) {
      wireTimer = setTimeout(() => {
        wireTimer = null;
        pumpWire();
      }, wireInterval);
      wireTimer.unref();
    }
  }
  function publish(frame, onSent, valid) {
    if (!ready) return Promise.reject(new Error("Public relay is offline"));
    const priority = ["ack", "reset", "reset_ack", "status", "clock_probe", "clock_reply"].includes(
      frame.type,
    );
    const key = frame.type + ":" + (frame.cid || "") + ":" + (frame.seq ?? "");
    const existing = wireJobs.get(key);
    if (existing) {
      existing.frame = frame;
      return existing.promise;
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job = { key, frame, onSent, valid, resolve, reject, promise };
    wireJobs.set(key, job);
    (priority ? wireControl : wireData).push(job);
    pumpWire();
    return promise;
  }
  const control = (frame) =>
    publish(frame).catch((error) =>
      trace("control_failed", null, { type: frame.type, error: error.message }),
    );
  function acknowledge(state) {
    if (!state.reliable || !ready) return;
    // Coalesce cumulative ACKs; a duplicate frame also triggers this path.
    if (!state.ackTimer)
      state.ackTimer = setTimeout(() => {
        state.ackTimer = null;
        control({ type: "ack", cid: state.cid, next: state.incoming });
      }, 15);
  }
  function forget(state) {
    if (connections.get(state.cid) !== state) return;
    // A clean local close must not cancel the final cumulative ACK before it
    // reaches the peer; otherwise even loss-free streams wait for a retransmit.
    if (state.reliable && ready && !state.reset)
      control({ type: "ack", cid: state.cid, next: state.incoming });
    connections.delete(state.cid);
    clearTimeout(state.openTimer);
    clearTimeout(state.ackTimer);
    if (state.reliable) {
      closed.set(state.cid, {
        next: state.incoming,
        expires: Date.now() + CLOSED_CACHE_MS,
      });
      while (closed.size > 256) closed.delete(closed.keys().next().value);
    }
    state.tx.clear();
    state.rx.clear();
    stats.closed++;
  }
  function reset(state, reason, notify = true) {
    if (state.reset) return;
    state.reset = true;
    trace("stream_reset", state, { reason });
    if (notify && ready) {
      if (state.reliable) {
        pendingResets.set(state.cid, {
          reason,
          createdAt: Date.now(),
          lastSent: Date.now(),
          attempts: 1,
        });
        while (pendingResets.size > 256)
          pendingResets.delete(pendingResets.keys().next().value);
        control({ type: "reset", cid: state.cid, reason });
      }
    }
    forget(state);
    state.socket.destroy();
  }
  function flow(state) {
    if(state.reset||!state.opened||!ready)return;
    while(state.unsent.length&&state.tx.size<WINDOW){
      const data=state.unsent.shift();enqueue(state,"data",data);
    }
    if(state.endPending&&!state.unsent.length&&state.tx.size<WINDOW){
      state.endPending=false;enqueue(state,"end");
    }
    if(!state.socket.destroyed&&!state.localEnded&&!state.unsent.length&&state.tx.size<WINDOW)
      state.socket.resume();
  }
  function transmit(state, item) {
    if (!ready || state.reset || item.queued) return;
    item.queued = true;
    publish(
      item.frame,
      () => {
        item.queued = false;
        item.attempts++;
        item.lastSent = performance.now();
        item.firstSentAt ??= item.lastSent;
        if (item.attempts > 1) {
          stats.retransmitted++;
          trace("retransmit", state, {
            seq: item.frame.seq,
            type: item.frame.type,
            attempt: item.attempts,
          });
        }
      },
      () => !state.reset && state.tx.has(item.frame.seq),
    ).catch(() => {
      if (!state.reset) reset(state, "publish_failed");
    });
  }
  function enqueue(state, type, data) {
    const frame = { cid: state.cid, seq: state.out++, type };
    if (type === "open" && state.reliable) frame.protocol = 57;
    if (data) frame.data = data.toString("base64");
    if (config.traceFrames)
      trace("frame_send", state, {
        type,
        seq: frame.seq,
        bytes: data?.length || 0,
      });
    if (state.reliable) {
      const item = { frame, createdAt: Date.now(), lastSent: 0, attempts: 0 };
      state.tx.set(frame.seq, item);
      transmit(state, item);
    }
  }
  function attach(cid, socket, reliable, incoming = 0) {
    const state = {
      cid,
      socket,
      reliable,
      incoming,
      out: 0,
      tx: new Map(),
      unsent: [],
      endPending: false,
      lastAckAt: performance.now(),
      deliveryRtt: 1000,
      rx: new Map(),
      queue: Promise.resolve(),
      createdAt: Date.now(),
      txBytes: 0,
      rxBytes: 0,
      opened: false,
      localEnded: false,
      remoteEnded: false,
      reset: false,
      draining: false,
      ackTimer: null,
    };
    connections.set(cid, state);
    stats.opened++;
    trace("socket_attached", state);
    socket.on("data", (chunk) => {
      socket.pause();
      const previousBytes=state.txBytes;state.txBytes += chunk.length;
      if(Math.floor(previousBytes/1048576)!==Math.floor(state.txBytes/1048576))trace("stream_progress",state,{direction:"send",queuedFrames:wireData.length});
      for (let offset = 0; offset < chunk.length; offset += CHUNK)
        state.unsent.push(chunk.subarray(offset, offset + CHUNK));
      flow(state);
    });
    socket.on("end", () => {
      state.localEnded = true;
      trace("socket_end", state);
      if (!state.reset) { state.endPending=true;flow(state); }
    });
    socket.on("error", (error) => {
      trace("socket_error", state, { code: error.code, error: error.message });
      reset(state, "local_socket_error");
    });
    socket.on("close", () => {
      trace("socket_close", state, {
        readableEnded: socket.readableEnded,
        writableFinished: socket.writableFinished,
      });
      if (state.reset) return;
      if (state.reliable) {
        if (!state.localEnded || !state.remoteEnded)
          return reset(state, "local_socket_closed");
        if (!state.tx.size) forget(state);
      }
    });
    return state;
  }
  function deliver(state) {
    if (state.draining || state.reset) return;
    const frame = state.rx.get(state.incoming);
    if (!frame) return;
    state.draining = true;
    const consumed = () => {
      if (state.reset) return;
      state.rx.delete(state.incoming);
      state.incoming++;
      state.draining = false;
      acknowledge(state);
      deliver(state);
    };
    if (frame.type === "opened" && role === "near") {
      state.opened = true;
      clearTimeout(state.openTimer);
      consumed();
      flow(state);
    } else if (
      frame.type === "data" &&
      state.opened &&
      typeof frame.data === "string"
    ) {
      const data = Buffer.from(frame.data, "base64");
      if (data.length > CHUNK || state.remoteEnded || state.socket.destroyed)
        return reset(state, "invalid_data_state");
      const previousBytes=state.rxBytes;state.rxBytes += data.length;
      if(Math.floor(previousBytes/1048576)!==Math.floor(state.rxBytes/1048576))trace("stream_progress",state,{direction:"receive",bufferedFrames:state.rx.size});
      state.socket.write(data, (error) =>
        error ? reset(state, "local_write_failed") : consumed(),
      );
    } else if (frame.type === "end") {
      state.remoteEnded = true;
      state.socket.end();
      consumed();
    } else reset(state, "invalid_stream_frame");
  }
  function receive(state, frame) {
    if (frame.seq < state.incoming) {
      stats.duplicates++;
      acknowledge(state);
      return;
    }
    if (frame.seq - state.incoming >= RECEIVE_WINDOW)
      return reset(state, "receive_window_exceeded");
    if (frame.seq > state.incoming && !state.rx.has(frame.seq)) {
      stats.reordered++;
      trace("frame_buffered", state, {
        seq: frame.seq,
        expected: state.incoming,
      });
    }
    if (!state.rx.has(frame.seq)) state.rx.set(frame.seq, frame);
    deliver(state);
  }
  client.on("connect", () =>
    client.subscribe(prefix + role, { qos: 1 }, (error) => {
      if (error) return events.emit("diagnostic", error.message);
      ready = true;
      brokerFailures = 0;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      epoch++;
      if (clock) { clock.reset();lastClockProbe=-Infinity;clockProbe(); }
      trace("mqtt_subscribed", null, { epoch });
      events.emit("ready");
    }),
  );
  client.on("error", (error) => {
    trace("mqtt_error", null, { error: error.message });
    events.emit("diagnostic", error.message);
  });
  client.on("close", () => {
    trace("mqtt_close");
    if (!config.reconnectPolicy || stopping) return;
    if (ready) {
      ready = false;
      trace("mqtt_offline");
      for (const state of [...connections.values()])
        reset(state, "broker_offline", false);
      events.emit("offline");
    }
    if (!reconnectTimer) {
      const attempt = ++brokerFailures;
      const delay =
        attempt <= 3
          ? 0
          : [1000, 2000, 4000, 8000, 10000][Math.min(attempt - 4, 4)];
      trace("mqtt_retry_scheduled", null, { attempt, delayMs: delay });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!stopping) client.reconnect();
      }, delay);
      reconnectTimer.unref();
    }
  });
  client.on("reconnect", () => trace("mqtt_reconnect"));
  client.on("offline", () => {
    ready = false;
    trace("mqtt_offline");
    for (const state of [...connections.values()])
      reset(state, "broker_offline", false);
    events.emit("offline");
  });
  client.on("message", (topic, raw) => {
    if (config.traceFrames)
      trace("message_packet", null, {
        bytes: raw.length,
        digest: crypto
          .createHash("sha256")
          .update(raw)
          .digest("hex")
          .slice(0, 16),
      });
    const reject = (reason) => {
      if (config.traceFrames)
        trace("packet_rejected", null, { reason, bytes: raw.length });
    };
    if (topic !== prefix + role || raw.length > 40000)
      return reject("topic_or_size");
    try {
      const envelope = JSON.parse(raw.toString());
      if (typeof envelope.body !== "string" || typeof envelope.mac !== "string")
        return reject("envelope_shape");
      const mac = Buffer.from(envelope.mac, "base64");
      if (
        mac.length !== 32 ||
        !crypto.timingSafeEqual(mac, sign(envelope.body))
      )
        return reject("authentication");
      const frame = JSON.parse(envelope.body);
      if (frame.applicationRelease !== "5.7" || frame.protocol !== 57) return reject("release_mismatch");
      if (frame.role !== opposite || !Number.isSafeInteger(frame.time)) return reject("role_or_time");
      const origin = frame.relayEpoch || frame.status?.relayEpoch || frame.status?.relayInstance;
      if (clock && frame.type === "clock_probe") {
        if (clock.shouldReply(origin,frame.nonce)) {
          control({type:"clock_reply",nonce:frame.nonce,challenge:clock.begin()});
        }
        return;
      }
      if (clock && frame.type === "clock_reply") {
        if (clock.accept(origin,frame.nonce,frame.time)) {
          trace("clock_proof_verified");
          if (typeof frame.challenge === "string" && /^[a-f0-9]{32}$/.test(frame.challenge)) control({type:"clock_reply",nonce:frame.challenge});
          if (lastStatus) events.status(lastStatus);
        }
        return;
      }
      if (clock ? !clock.validTime(origin,frame.time) : Math.abs(Date.now()-frame.time)>120000) {
        if (clock) clockProbe();
        return reject("role_or_time");
      }
      // Admission-enabled far ends can hear several authorized near ends.
      // A status probe from a different controller must never reset live streams.
      if (origin && typeof origin === "string" && !(role === "far" && config.connectionAdmission)) {
        if (peerInstance && origin !== peerInstance) {
          if (clock) {
            if (retiredPeers.has(origin)) return reject("retired_peer_epoch");
            if (!clock.provenAfter(origin,peerSwitchedAt)) { clockProbe();return reject("unproven_peer_restart"); }
            retiredPeers.add(peerInstance);
            while(retiredPeers.size>128)retiredPeers.delete(retiredPeers.values().next().value);
          } else if (frame.time < lastPeerStatus) return;
          trace("peer_instance_changed");
          for (const state of [...connections.values()])
            reset(state, "peer_restarted", false);
        }
        if (peerInstance !== origin) peerSwitchedAt=performance.now();
        peerInstance = origin;
        lastPeerStatus = Math.max(lastPeerStatus, frame.time);
      }
      if (frame.type === "status") {
        const peer = frame.status;
        if (!peer || typeof peer !== "object") return reject("status_shape");
        if (peer.applicationRelease !== "5.7" || peer.relayProtocol !== 57) return reject("release_mismatch");
        peerProtocol = 57;
        events.emit("peer", peer);
        return;
      }
      if (!/^[a-f0-9]{32}$/.test(frame.cid)) return reject("connection_id");
      let state = connections.get(frame.cid);
      if (frame.type === "ack") {
        if (
          !state?.reliable ||
          !Number.isSafeInteger(frame.next) ||
          frame.next < 0 ||
          frame.next > state.out
        )
          return;
        let progressed=false;
        for (const [seq,item] of state.tx)
          if (seq < frame.next) {
            if(item.attempts===1&&item.firstSentAt!==undefined)
              state.deliveryRtt=Math.max(100,0.75*state.deliveryRtt+0.25*(performance.now()-item.firstSentAt));
            state.tx.delete(seq);progressed=true;
          }
        if(progressed)state.lastAckAt=performance.now();
        if (config.traceFrames)
          trace("delivery_ack", state, { next: frame.next });
        flow(state);
        if (state.socket.destroyed && !state.tx.size) forget(state);
        return;
      }
      if (frame.type === "reset_ack") {
        pendingResets.delete(frame.cid);
        return;
      }
      if (frame.type === "reset") {
        control({ type: "reset_ack", cid: frame.cid });
        if (state?.reliable)
          reset(
            state,
            ["capacity", "local_ssh_unavailable"].includes(frame.reason)
              ? frame.reason
              : "peer_reset",
            false,
          );
        return;
      }
      if (!Number.isSafeInteger(frame.seq) || frame.seq < 0)
        return reject("sequence");
      if (role === "far" && frame.type === "open" && frame.seq === 0) {
        if (state) {
          if (state.reliable) acknowledge(state);
          return;
        }
        if (closed.has(frame.cid)) {
          control({
            type: "ack",
            cid: frame.cid,
            next: closed.get(frame.cid).next,
          });
          return;
        }
        const reliable = true;
        if (
          [...connections.values()].filter((s) => !s.socket.destroyed).length >=
          256
        ) {
          stats.rejected++;
          trace("open_rejected", null, { cid: frame.cid, reason: "capacity" });
          control(
            { type: "reset", cid: frame.cid, reason: "capacity" },
          );
          return;
        }
        const socket = net.connect({
          host: "127.0.0.1",
          port: config.sshPort,
          allowHalfOpen: true,
        });
        socket.pause();
        state = attach(frame.cid, socket, reliable, 0);
        socket.pause();
        socket.once("connect", () => {
          if (state.reset) return;
          state.opened = true;
          state.incoming = 1;
          trace("far_tcp_connected", state);
          acknowledge(state);
          enqueue(state, "opened");
          flow(state);
        });
        socket.once("error", () => reset(state, "local_ssh_unavailable"));
        return;
      }
      if (!state) {
        const entry = closed.get(frame.cid);
        if (entry) control({ type: "ack", cid: frame.cid, next: entry.next });
        return;
      }
      if (config.traceFrames)
        trace("frame_receive", state, { type: frame.type, seq: frame.seq });
      return receive(state, frame);
    } catch (error) {
      trace("packet_exception", null, { message: error.message });
    }
  });
  const retransmitter = setInterval(() => {
    const now = Date.now();
    for (const [cid, item] of pendingResets) {
      if (now - item.createdAt > DELIVERY_TIMEOUT) {
        trace("reset_delivery_timeout", null, { cid });
        pendingResets.delete(cid);
        continue;
      }
      if (ready && now - item.lastSent >= 2000) {
        item.lastSent = now;
        item.attempts++;
        trace("reset_retransmit", null, { cid, attempt: item.attempts });
        control({ type: "reset", cid, reason: item.reason });
      }
    }
    for (const [cid, entry] of closed)
      if (entry.expires < now) closed.delete(cid);
    for (const state of [...connections.values()])
      if (state.reliable && !state.reset) {
        const items=[...state.tx.values()],oldest=items[0],monotonic=performance.now();
        const queueWait=(wireData.length+wireControl.length)*wireInterval*2;
        // Queueing and a long transfer are not delivery failures. Only a sent
        // stream with no cumulative ACK progress can reach this deadline.
        if(oldest?.firstSentAt!==undefined&&monotonic-Math.max(state.lastAckAt,oldest.firstSentAt)>DELIVERY_TIMEOUT+Math.min(queueWait,15000)){
          stats.deliveryTimeouts++;reset(state,"delivery_ack_timeout");continue;
        }
        for(const item of items){
          const delay=Math.min(15000,Math.max(3000,state.deliveryRtt*3+queueWait)*2**Math.min(Math.max(0,item.attempts-1),2));
          if(!item.queued&&(item.firstSentAt===undefined||monotonic-item.lastSent>=delay))transmit(state,item);
        }
      }
  }, 100);
  retransmitter.unref();
  events.open = (socket) => {
    if (!ready || stopping) return socket.destroy();
    socket.pause();
    const cid = crypto.randomBytes(16).toString("hex");
    const state = attach(cid, socket, peerProtocol === 57);
    socket.pause();
    enqueue(state, "open");
    state.openTimer = setTimeout(
      () => {
        if (!state.opened) reset(state, "open_timeout");
      },
      DELIVERY_TIMEOUT + 1000,
    );
    state.openTimer.unref();
  };
  const clockTimer = clock ? setInterval(() => {
    if (!clock.peers.size || performance.now()-lastClockProbe>=30000) clockProbe();
  },5000) : null;
  clockTimer?.unref();
  events.status = (status) => {
    lastStatus=status;
    return publish({
      type: "status",
      status: {
        ...status,
        applicationRelease: "5.7",
        relayProtocol: 57,
        relayInstance: instance,
        relayEpoch: instance + ":" + epoch,
      },
    });
  };
  events.snapshot = () => ({
    ...stats,
    active: [...connections.values()].filter((s) => !s.socket.destroyed).length,
    pendingFrames: [...connections.values()].reduce((n, s) => n + s.tx.size, 0),
    protocol: peerProtocol,
    pendingResets: pendingResets.size,
  });
  events.close = () => {
    stopping = true;
    ready = false;
    clearInterval(retransmitter);
    if(clockTimer)clearInterval(clockTimer);
    clearTimeout(reconnectTimer);
    clearTimeout(wireTimer);
    wireTimer = null;
    pumpWire();
    pendingResets.clear();
    for (const state of [...connections.values()])
      reset(state, "shutdown", false);
    client.end(true);
  };
  return events;
}
module.exports = { createRelay };
