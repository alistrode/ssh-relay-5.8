"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { Admission, probe, verifyProbe } = require("../../src/pro/admission.cjs");
const { keyPair } = require("../../src/pro/keys.cjs");
const id = () => crypto.randomUUID();
test("a competing controller is refused while the original connection stays owned", () => {
  const a=id(), b=id(), gate=new Admission(), token=gate.reserve(a);
  assert(gate.connected(token)); assert.equal(gate.reserve(b),null);
  assert.equal(gate.request({ controllerId:b,requestId:id() }),false);
  assert(gate.canStart(token)); assert.equal(gate.snapshot().activeConnections,1);
});
test("consent prepares a replacement; ownership changes only after it is ready", () => {
  const a=id(), b=id(), gate=new Admission(), old=gate.reserve(a), requestId=id();
  gate.connected(old); gate.request({controllerId:b,requestId}); gate.decide(requestId,true);
  assert(gate.canStart(old)); const next=gate.reserve(b); assert(gate.canStart(old));
  assert(gate.connected(next)); assert.equal(gate.canStart(old),false); assert(gate.canStart(next));
  assert.equal(gate.snapshot().activeConnections,2); assert.equal(gate.snapshot().drainingConnections,1);
  gate.closed(old); assert(gate.canStart(next));
});
test("decline, timeout and a replacement that never becomes ready preserve the owner", () => {
  let now=100;const gate=new Admission({now:()=>now}),a=id(),b=id(),old=gate.reserve(a);gate.connected(old);
  const one=id();gate.request({controllerId:b,requestId:one});gate.decide(one,false);assert.equal(gate.reserve(b),null);assert(gate.canStart(old));
  const two=id();gate.request({controllerId:b,requestId:two});gate.decide(two,true);const failed=gate.reserve(b);
  now+=16000;gate.expire();assert.equal(gate.connected(failed),false);assert(gate.canStart(old));
  const three=id();gate.request({controllerId:b,requestId:three});now+=61000;assert.throws(()=>gate.decide(three,true));assert(gate.canStart(old));
});
test("racing requests cannot silently replace an approved or live controller", () => {
  const gate=new Admission(),a=id(),b=id(),c=id(),old=gate.reserve(a);gate.connected(old);
  const first=id(),second=id();gate.request({controllerId:b,requestId:first});gate.request({controllerId:c,requestId:second});
  gate.decide(first,true);assert.throws(()=>gate.decide(second,true));assert.equal(gate.reserve(c),null);assert(gate.canStart(old));
});
test("authorized signatures bind probes to the controller and prevent forged notifications", () => {
  const a=id(),keys=keyPair(),other=keyPair(),registry={[a]:{publicKey:keys.publicKey,label:'near'}};
  const envelope=probe(keys.privateKey,a,id());assert.equal(verifyProbe(envelope,registry).controllerId,a);
  assert.equal(verifyProbe(probe(other.privateKey,a,id()),registry),null);
  assert.equal(verifyProbe(envelope,registry,Date.now()+121000),null);
  assert.equal(verifyProbe({...envelope,payload:envelope.payload.replace(a,id())},registry),null);
});
test("repeated probes do not create repeated popups and unknown decisions fail closed", () => {
  const gate=new Admission(),a=id(),b=id(),old=gate.reserve(a);gate.connected(old);
  for(let i=0;i<100;i++)gate.request({controllerId:b,requestId:id()});
  assert.equal(gate.snapshot().pending.length,1);assert.throws(()=>gate.decide(id(),true));assert(gate.canStart(old));
});
test("revoking another controller preserves the current owner and sessions", () => {
  const gate=new Admission(),a=id(),b=id(),token=gate.reserve(a);gate.connected(token);
  gate.request({controllerId:b,requestId:id()});gate.revoke(b);assert(gate.canStart(token));assert.equal(gate.snapshot().pending.length,0);
  gate.revoke(a);assert.equal(gate.canStart(token),false);assert.equal(gate.snapshot().ownerId,null);
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
