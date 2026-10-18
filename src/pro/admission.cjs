"use strict";
const crypto = require("node:crypto");
const { utils } = require("ssh2");
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
function probe(privateKey, controllerId, requestId) {
  if (!validId(controllerId) || !validId(requestId)) throw Error("Invalid admission request");
  const payload = JSON.stringify({ controllerId, requestId, time: Date.now() });
  const key = utils.parseKey(privateKey);
  if (key instanceof Error) throw key;
  const signature = key.sign(Buffer.from(payload));
  if (signature instanceof Error) throw signature;
  return { payload, signature: signature.toString("base64") };
}
function verifyProbe(envelope, authorized, now = Date.now()) {
  try {
    if (typeof envelope?.payload !== "string" || envelope.payload.length > 512 || typeof envelope.signature !== "string" || envelope.signature.length > 256) return null;
    const value = JSON.parse(envelope.payload);
    if (!validId(value.controllerId) || !validId(value.requestId) || !Number.isSafeInteger(value.time) || Math.abs(now - value.time) > 120000) return null;
    const entry = authorized[value.controllerId];
    if (!entry) return null;
    const key = utils.parseKey(entry.publicKey);
    if (key instanceof Error || key.verify(Buffer.from(envelope.payload), Buffer.from(envelope.signature, "base64")) !== true) return null;
    return { ...value, label: String(entry.label || "Authorized near end").slice(0, 80) };
  } catch { return null; }
}
class Admission {
  constructor({ now = Date.now, onChange = () => {}, ttl = 60000 } = {}) {
    this.now = now; this.onChange = onChange; this.ttl = ttl;
    this.owner = null; this.pending = new Map(); this.denied = new Map();
    this.sessions = new Map(); this.reservations = new Map(); this.approved = null;
  }
  emit() { this.onChange(this.snapshot()); }
  expire() {
    const now = this.now(); let changed = false;
    for (const [id, r] of this.pending) if (r.expiresAt <= now) { this.pending.delete(id); changed = true; }
    for (const [id, until] of this.denied) if (until <= now) this.denied.delete(id);
    for (const [token, r] of this.reservations) if (r.expiresAt <= now) { this.reservations.delete(token); changed = true; }
    if (this.approved && this.approved.expiresAt <= now) { this.approved = null; changed = true; }
    if (this.owner && ![...this.sessions.values(), ...this.reservations.values()].some(r => r.controllerId === this.owner)) { this.owner = null; this.approved = null; changed = true; }
    return changed;
  }
  request(value) {
    this.expire();
    if (!validId(value?.controllerId) || !validId(value.requestId)) return false;
    if (!this.owner || value.controllerId === this.owner) return true;
    if (this.pending.has(value.requestId) || this.denied.has(value.requestId) || this.approved?.requestId === value.requestId) return false;
    if (this.pending.size >= 8) return false;
    // One outstanding notification per authorized controller, even if it retries.
    if ([...this.pending.values()].some(r => r.controllerId === value.controllerId)) return false;
    this.pending.set(value.requestId, { controllerId:value.controllerId, requestId:value.requestId, label:String(value.label || "Authorized near end").slice(0,80), owner:this.owner, expiresAt:this.now()+this.ttl });
    this.emit(); return false;
  }
  decide(requestId, approve) {
    this.expire();
    const request = this.pending.get(requestId);
    if (!request || request.owner !== this.owner || typeof approve !== "boolean" || (approve && this.approved)) throw Error("Switch request expired or changed");
    this.pending.delete(requestId);
    this.denied.set(requestId, this.now() + 600000);
    while (this.denied.size > 128) this.denied.delete(this.denied.keys().next().value);
    if (approve) this.approved = { ...request, expiresAt: this.now()+15000 };
    this.emit(); return true;
  }
  reserve(controllerId, label = "Authorized near end") {
    this.expire();
    if (!validId(controllerId)) return null;
    if (this.owner && this.owner !== controllerId && this.approved?.controllerId !== controllerId) return null;
    if (!this.owner) this.owner = controllerId;
    const token = crypto.randomUUID();
    this.reservations.set(token, { controllerId, label, expiresAt:this.now()+15000 });
    this.emit(); return token;
  }
  connected(token) {
    this.expire();
    const reservation = this.reservations.get(token);
    if (!reservation) return false;
    if (!this.owner) this.owner = reservation.controllerId;
    if (this.owner !== reservation.controllerId) {
      if (this.approved?.controllerId !== reservation.controllerId || this.approved.owner !== this.owner) return false;
      this.owner = reservation.controllerId; this.approved = null; this.pending.clear();
    }
    this.reservations.delete(token); this.sessions.set(token, reservation);
    this.emit(); return true;
  }
  canStart(token) { this.expire(); return this.sessions.get(token)?.controllerId === this.owner; }
  closed(token) { this.reservations.delete(token); this.sessions.delete(token); this.expire(); this.emit(); }
  controllerFor(token) { return this.sessions.get(token)?.controllerId || this.reservations.get(token)?.controllerId; }
  revoke(controllerId) {
    for (const [id,r] of this.pending) if (r.controllerId === controllerId) this.pending.delete(id);
    for (const map of [this.sessions,this.reservations]) for (const [token,r] of map) if (r.controllerId === controllerId) map.delete(token);
    if (this.approved?.controllerId === controllerId) this.approved = null;
    this.expire(); this.emit();
  }
  snapshot() {
    return { ownerId:this.owner, activeConnections:this.sessions.size, drainingConnections:[...this.sessions.values()].filter(s=>s.controllerId!==this.owner).length, approvedId:this.approved?.controllerId || null, pending:[...this.pending.values()] };
  }
}
module.exports = { Admission, probe, verifyProbe };
