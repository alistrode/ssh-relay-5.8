"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { Admission, probe, verifyProbe } = require("../../src/pro/admission.cjs");
const { keyPair } = require("../../src/pro/keys.cjs");
const id = () => crypto.randomUUID();
test("five independent controllers can all start work; the sixth cannot reserve a slot", () => {
  const gate=new Admission(),tokens=Array.from({length:5},()=>gate.reserve(id()));
  for(const token of tokens){assert(token);assert(gate.connected(token));assert(gate.canStart(token));}
  assert.equal(gate.reserve(id()),null);
  for(const token of tokens)assert(gate.canStart(token));
  assert.equal(gate.snapshot().connectedControllerIds.length,5);
});
test("reservations count towards capacity; one controller's transports share a slot", () => {
  let now=100;const gate=new Admission({now:()=>now}),ids=Array.from({length:5},id);
  const tokens=ids.map(x=>gate.reserve(x));
  assert.equal(gate.reserve(id()),null);
  const same=gate.reserve(ids[0]);assert(same);assert(gate.connected(same));
  now+=16000;gate.expire();assert.equal(gate.connected(tokens[1]),false);
  assert(gate.reserve(id()));assert(gate.canStart(same));
});
test("closing or revoking one controller preserves all others and frees one slot", () => {
  const gate=new Admission(),ids=Array.from({length:5},id),tokens=ids.map(x=>gate.reserve(x));
  tokens.forEach(t=>gate.connected(t));gate.revoke(ids[1]);
  assert(!gate.canStart(tokens[1]));for(const i of [0,2,3,4])assert(gate.canStart(tokens[i]));
  assert(gate.reserve(id()));gate.closed(tokens[2]);assert(gate.canStart(tokens[0]));
});
test("authorized signatures bind probes to the controller and prevent forged notifications", () => {
  const a=id(),keys=keyPair(),other=keyPair(),registry={[a]:{publicKey:keys.publicKey,label:'near'}};
  const envelope=probe(keys.privateKey,a,id());assert.equal(verifyProbe(envelope,registry).controllerId,a);
  assert.equal(verifyProbe(probe(other.privateKey,a,id()),registry),null);
  assert.equal(verifyProbe(envelope,registry,Date.now()+121000),null);
  assert.equal(verifyProbe({...envelope,payload:envelope.payload.replace(a,id())},registry),null);
});
test("concurrent admission never creates takeover prompts", () => {
  const gate=new Admission(),a=id(),b=id(),token=gate.reserve(a);gate.connected(token);
  for(let i=0;i<100;i++)assert(gate.request({controllerId:b,requestId:id()}));
  assert.deepEqual(gate.snapshot().pending,[]);assert.throws(()=>gate.decide(id(),true));assert(gate.canStart(token));
});

test("server challenges admit skewed clocks and reject expired or foreign challenge replays", () => {
  let now = 1000;
  const state = new Admission({now:()=>now}), keys=keyPair(), controller=crypto.randomUUID(), request=crypto.randomUUID();
  const authorized={[controller]:{publicKey:keys.publicKey,label:"skewed near"}}, challenge=state.snapshot().challenge;
  const signed=probe(keys.privateKey,controller,request,challenge);
  assert(verifyProbe(signed,authorized,Date.now()+7*3600000,v=>state.acceptsChallenge(v)));
  assert.equal(verifyProbe(probe(keys.privateKey,controller,request,"0".repeat(32)),authorized,Date.now(),v=>state.acceptsChallenge(v)),null);
  now+=60001;assert.notEqual(state.snapshot().challenge,challenge);
  assert(verifyProbe(signed,authorized,Date.now()-7*3600000,v=>state.acceptsChallenge(v)));
  now+=60000;assert.equal(verifyProbe(signed,authorized,Date.now(),v=>state.acceptsChallenge(v)),null);
});
