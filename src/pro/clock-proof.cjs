"use strict";
// Calibrate only from a live HMAC-authenticated peer's reply to our fresh nonce.
// Each sender epoch has its own offset; no wall-clock agreement is required.
const crypto=require('node:crypto');
class ClockProof {
 constructor({now=Date.now,monotonic=()=>performance.now()}={}){this.now=now;this.monotonic=monotonic;this.reset();}
 reset(){this.pending=new Map();this.peers=new Map();this.requests=new Map();}
 validOrigin(origin){return typeof origin==='string'&&/^[a-f0-9]{16}:\d{1,10}$/.test(origin);}
 prune(){const now=this.monotonic();for(const map of [this.pending,this.peers,this.requests])for(const[k,v]of map)if(v.until<=now)map.delete(k);}
 begin(){this.prune();const nonce=crypto.randomBytes(16).toString('hex');this.pending.set(nonce,{started:this.monotonic(),until:this.monotonic()+15000,origins:new Set()});while(this.pending.size>8)this.pending.delete(this.pending.keys().next().value);return nonce;}
 shouldReply(origin,nonce){this.prune();if(!this.validOrigin(origin)||typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce))return false;const now=this.monotonic();if(this.requests.get(origin)?.until>now)return false;this.requests.set(origin,{until:now+1000});while(this.requests.size>128)this.requests.delete(this.requests.keys().next().value);return true;}
 accept(origin,nonce,time){this.prune();const p=this.pending.get(nonce);if(!p||!this.validOrigin(origin)||!Number.isSafeInteger(time)||p.origins.has(origin))return false;p.origins.add(origin);const previous=this.peers.get(origin);if(previous&&previous.probeStarted>=p.started)return false;
 this.peers.delete(origin);this.peers.set(origin,{offset:time-this.now(),probeStarted:p.started,until:this.monotonic()+180000});while(this.peers.size>128)this.peers.delete(this.peers.keys().next().value);return true;}
 has(origin){this.prune();return this.peers.has(origin);}
 provenAfter(origin,when){this.prune();return (this.peers.get(origin)?.probeStarted??-Infinity)>when;}
 validTime(origin,time){if(!Number.isSafeInteger(time))return false;if(Math.abs(this.now()-time)<=120000)return true;this.prune();const p=this.peers.get(origin);return !!p&&Math.abs(this.now()+p.offset-time)<=120000;}
}
module.exports={ClockProof};
