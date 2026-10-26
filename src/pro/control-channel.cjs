"use strict";
const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const MAX_FRAME = 1024 * 1024;
function error(code, message, retryable = false) {
  return Object.assign(Error(message), { code, retryable });
}
function framing(stream, onFrame, onClose = () => {}) {
  let input = Buffer.alloc(0), output = [], outputBytes = 0, blocked = false, closed = false, ending = false;
  const close = () => {
    if (closed) return;
    closed = true;
    input = Buffer.alloc(0); output = []; outputBytes = 0;
    onClose();
  };
  const fail = () => { close(); stream.destroy(); };
  function flush() {
    if (closed || blocked) return;
    while (output.length) {
      const frame = output.shift();
      outputBytes -= frame.length;
      if (!stream.write(frame)) {
        blocked = true;
        stream.pause();
        stream.once("drain", () => { blocked = false; flush(); if (!closed && !blocked) stream.resume(); });
        return;
      }
    }
    if (ending) { stream.end(); close(); }
  }
  stream.on("data", chunk => {
    if (closed) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const needed = input.length < 4 ? 4 : input.readUInt32BE(0) + 4;
        const take = Math.min(needed - input.length, chunk.length - offset);
        input = Buffer.concat([input, chunk.subarray(offset, offset + take)]);
        offset += take;
        if (input.length < 4) continue;
        const size = input.readUInt32BE(0);
        if (size < 2 || size > MAX_FRAME) { fail(); return; }
        if (input.length < size + 4) continue;
        const frame = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.subarray(4)));
        input = Buffer.alloc(0);
        onFrame(frame, size);
        if (closed) return;
      }
    } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'control-channel.cjs',line:49}); fail(); }
  });
  stream.on("error", close);
  stream.on("close", close);
  stream.on("end", () => { close(); stream.end(); });
  return {
    send(value) {
      if (closed || ending) return false;
      const body = Buffer.from(JSON.stringify(value));
      if (body.length > MAX_FRAME) throw error("CONTROL_FRAME_TOO_LARGE", "Control response exceeds frame limit");
      const frame = Buffer.allocUnsafe(body.length + 4);
      frame.writeUInt32BE(body.length); body.copy(frame, 4);
      if (outputBytes + frame.length > 2 * MAX_FRAME) { fail(); return false; }
      output.push(frame); outputBytes += frame.length; flush();
      return !closed;
    },
    end() { if (!closed) { ending = true; flush(); } },
    closed: () => closed || ending,
  };
}
function serveControl(stream, handler, { canStart = () => true } = {}) {
  let active = 0, queuedBytes = 0, draining = false;
  const queue = [], ids = new Set();
  const channel = framing(stream, (frame, bytes) => {
    if (!frame || typeof frame !== "object" || typeof frame.rpcId !== "string" ||
        !frame.rpcId.length || frame.rpcId.length > 128 ||
        typeof frame.method !== "string" || frame.method.length > 64 ||
        !frame.params || typeof frame.params !== "object" || Array.isArray(frame.params)) {
      channel.end(); return;
    }
    if (ids.has(frame.rpcId)) {
      sendError(frame.rpcId, error("REQUEST_CONFLICT", "rpcId is already pending")); return;
    }
    if (draining || !canStart(frame.method)) {
      sendError(frame.rpcId, error("CONTROL_NOT_ADMITTED", "Controller may not start this request")); return;
    }
    if (queue.length >= 32 || queuedBytes + bytes > 2 * MAX_FRAME) {
      sendError(frame.rpcId, error("CONTROL_CAPACITY", "Control request queue is full", true)); return;
    }
    ids.add(frame.rpcId);
    queue.push({ frame, bytes }); queuedBytes += bytes;
    pump();
  }, () => { queue.length = 0; queuedBytes = 0; ids.clear(); });
  function sendError(rpcId, failure) {
    channel.send({ rpcId, ok: false, error: {
      code: failure.code || "CONTROL_FAILED", message: failure.code ? failure.message : "Control operation failed",
      retryable: failure.retryable === true,
    } });
  }
  function pump() {
    while (!channel.closed() && active < 4 && queue.length) {
      const { frame, bytes } = queue.shift();
      queuedBytes -= bytes; active++;
      Promise.resolve().then(() => {
        if (channel.closed()) throw error("CONTROL_CLOSED", "Control channel closed before request dispatch");
        if (!canStart(frame.method)) throw error("CONTROL_NOT_ADMITTED", "Controller may not start this request");
        return handler(frame.method, frame.params);
      }).then(result => {
        try { channel.send({ rpcId: frame.rpcId, ok: true, result }); }
        catch (failure) { require('./runtime-log.cjs').captureCaught(failure,{component:'control-channel.cjs',line:108}); sendError(frame.rpcId, failure); }
      }, failure => sendError(frame.rpcId, failure)).finally(() => {
        active--; ids.delete(frame.rpcId);
        pump();
        if (draining && !active && !queue.length) channel.end();
      }).catch(() => channel.end());
    }
  }
  return {
    drain() { draining = true; if (!active && !queue.length) channel.end(); },
    close: () => channel.end(),
  };
}
class ControlClient {
  constructor(stream) {
    this.pending = new Map();
    this.channel = framing(stream, frame => {
      if (!frame || typeof frame.rpcId !== "string" || typeof frame.ok !== "boolean")
        return this.channel.end();
      const request = this.pending.get(frame.rpcId);
      if (!request) return;
      this.pending.delete(frame.rpcId); clearTimeout(request.timer);
      if (frame.ok) request.resolve(frame.result);
      else request.reject(error(frame.error?.code || "CONTROL_FAILED",
        frame.error?.message || "Control operation failed", frame.error?.retryable === true));
    }, () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error("CONTROL_CLOSED", "Control channel closed; submitted operation outcome may be unknown", true));
      }
      this.pending.clear();
    });
  }
  request(method, params = {}, { timeoutMs = 20000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      return Promise.reject(error("INVALID_REQUEST", "Invalid control timeout"));
    if (this.channel.closed()) return Promise.reject(error("CONTROL_CLOSED", "Control channel is closed", true));
    if (this.pending.size >= 32) return Promise.reject(error("CONTROL_CAPACITY", "Too many pending control requests", true));
    const rpcId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rpcId);
        reject(error("CONTROL_TIMEOUT", "Control request timed out; query the same operation ID before retrying", true));
      }, timeoutMs);
      this.pending.set(rpcId, { resolve, reject, timer });
      try { this.channel.send({ rpcId, method, params }); }
      catch (failure) { require('./runtime-log.cjs').captureCaught(failure,{component:'control-channel.cjs',line:154});
        clearTimeout(timer); this.pending.delete(rpcId); reject(failure);
      }
    });
  }
  close() { this.channel.end(); }
}
module.exports = { MAX_FRAME, framing, serveControl, ControlClient };
