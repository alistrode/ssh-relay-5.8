"use strict";
const crypto = require("node:crypto");
const { utils } = require("ssh2");
const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
function probe(privateKey, controllerId, requestId, challenge) {
  if (!validId(controllerId) || !validId(requestId)) throw Error("Invalid admission request");
  const payload = JSON.stringify({ controllerId, requestId, time: Date.now(), ...(challenge ? {challenge} : {}) });
  const key = utils.parseKey(privateKey);
  if (key instanceof Error) throw key;
  const signature = key.sign(Buffer.from(payload));
  if (signature instanceof Error) throw signature;
  return { payload, signature: signature.toString("base64") };
}
function verifyProbe(envelope, authorized, now = Date.now(), acceptChallenge = null) {
  try {
    if (typeof envelope?.payload !== "string" || envelope.payload.length > 512 || typeof envelope.signature !== "string" || envelope.signature.length > 256) return null;
    const value = JSON.parse(envelope.payload);
    if (!validId(value.controllerId) || !validId(value.requestId) || !Number.isSafeInteger(value.time) ) return null;
    if (acceptChallenge ? !acceptChallenge(value.challenge) : Math.abs(now - value.time) > 120000) return null;
    const entry = authorized[value.controllerId];
    if (!entry || entry.enabled === false) return null;
    const key = utils.parseKey(entry.publicKey);
    if (key instanceof Error || key.verify(Buffer.from(envelope.payload), Buffer.from(envelope.signature, "base64")) !== true) return null;
    return { ...value, label: String(entry.label || "Authorized near end").slice(0, 80) };
  } catch { return null; }
}
class Admission {
  constructor({ now = Date.now, onChange = () => {}, ttl = 60000 } = {}) {
    this.now = now; this.onChange = onChange; this.ttl = ttl;
    this.limit = 5;
    this.sessions = new Map(); this.reservations = new Map();
    this.pending = new Map();
    this.denied = new Map();
    this.challenges = new Map(); this.challenge = null; this.challengeAt = -Infinity;
  }
  currentChallenge() {
    const now = this.now();
    for (const [value,until] of this.challenges) if (until <= now) this.challenges.delete(value);
    if (now - this.challengeAt >= 60000 || !this.challenges.has(this.challenge)) {
      this.challenge = crypto.randomBytes(16).toString("hex"); this.challengeAt = now;
      this.challenges.set(this.challenge, now + 120000);
    }
    return this.challenge;
  }
  acceptsChallenge(value) { this.currentChallenge(); return typeof value === "string" && this.challenges.has(value); }
  emit() { this.onChange(this.snapshot()); }
  expire() {
    const now = this.now(); let changed = false;
    for (const [id,until] of this.denied) if (until<=now) this.denied.delete(id);
    for (const [id,r] of this.pending) if (r.expiresAt <= now) { this.pending.delete(id); changed = true; }
    for (const [token, r] of this.reservations) if (r.expiresAt <= now) { this.reservations.delete(token); changed = true; }
    return changed;
  }
  request(value) {
    this.expire();
    if (!validId(value?.controllerId) || !validId(value.requestId)) return false;
    const controllers = this.controllers();
    if (controllers.has(value.controllerId) || controllers.size < this.limit) return true;
    if (this.denied.has(value.requestId)) return false;
    if (this.pending.size >= 8 || [...this.pending.values()].some(r => r.controllerId === value.controllerId)) return false;
    this.pending.set(value.requestId,{controllerId:value.controllerId,requestId:value.requestId,
      label:String(value.label || "已授权电脑").slice(0,80),expiresAt:this.now()+this.ttl});
    this.emit(); return false;
  }
  decide(requestId, approve, replaceControllerId) {
    this.expire();
    const request=this.pending.get(requestId);
    if (!request || typeof approve !== "boolean") throw Error("Connection request expired");
    if (approve && (!validId(replaceControllerId) || !this.controllers().has(replaceControllerId)))
      throw Error("Select one currently connected controller to replace");
    this.pending.delete(requestId);
    if (!approve) {
      this.denied.set(requestId,this.now()+600000);
      while(this.denied.size>128)this.denied.delete(this.denied.keys().next().value);
    }
    if (approve) {
      this.revoke(replaceControllerId);
      // Hold the freed slot for the chosen requester while it retries SSH.
      const token=crypto.randomUUID();
      this.reservations.set(token,{controllerId:request.controllerId,label:request.label,expiresAt:this.now()+45000,invitation:true});
    }
    this.emit(); return true;
  }
  controllers() {
    return new Set([...this.sessions.values(), ...this.reservations.values()].map(r => r.controllerId));
  }
  reserve(controllerId, label = "Authorized near end") {
    this.expire();
    if (!validId(controllerId)) return null;
    const controllers = this.controllers();
    if (!controllers.has(controllerId) && controllers.size >= this.limit) return null;
    // Multiple SSH transports for one authenticated controller share one slot.
    if (this.sessions.size + this.reservations.size >= 64) return null;
    const token = crypto.randomUUID();
    this.reservations.set(token, { controllerId, label, expiresAt:this.now()+15000 });
    this.emit(); return token;
  }
  connected(token) {
    this.expire();
    const reservation = this.reservations.get(token);
    if (!reservation) return false;
    this.reservations.delete(token); this.sessions.set(token, reservation);
    for (const [key,r] of this.reservations) if (r.invitation && r.controllerId===reservation.controllerId) this.reservations.delete(key);
    this.emit(); return true;
  }
  canStart(token) { this.expire(); return this.sessions.has(token); }
  closed(token) { this.reservations.delete(token); this.sessions.delete(token); this.expire(); this.emit(); }
  controllerFor(token) { return this.sessions.get(token)?.controllerId || this.reservations.get(token)?.controllerId; }
  revoke(controllerId) {
    for (const [id,r] of this.pending) if (r.controllerId === controllerId) this.pending.delete(id);
    for (const map of [this.sessions,this.reservations]) for (const [token,r] of map) if (r.controllerId === controllerId) map.delete(token);
    this.expire(); this.emit();
  }
  snapshot() {
    const connected = [...new Set([...this.sessions.values()].map(s => s.controllerId))];
    return { challenge:this.currentChallenge(), mode:"concurrent", limit:this.limit,
      controllerIds:[...this.controllers()], connectedControllerIds:connected,
      ownerId:null, activeConnections:this.sessions.size, drainingConnections:0, approvedId:null, pending:[...this.pending.values()] };
  }
}
module.exports = { Admission, probe, verifyProbe };
