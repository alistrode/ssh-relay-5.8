"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ClockProof}=require('../../src/pro/clock-proof.cjs');
const a='1'.repeat(16)+':1',b='2'.repeat(16)+':1';
test('live nonce proofs support opposite clock offsets without widening replay freshness',()=>{
 let wall=1000000,mono=1;const c=new ClockProof({now:()=>wall,monotonic:()=>mono});
 assert(!c.validTime(a,wall+7*3600000));const n=c.begin();assert(!c.accept(a,'0'.repeat(32),wall+7*3600000));assert(c.accept(a,n,wall+7*3600000));assert(c.validTime(a,wall+7*3600000));assert(!c.validTime(a,wall+7*3600000-120001));assert(!c.accept(a,n,wall+7*3600000));
 mono+=1;assert(c.accept(b,c.begin(),wall-7*3600000));assert(c.validTime(b,wall-7*3600000));assert(c.validTime(a,wall+7*3600000));assert(c.provenAfter(b,1));assert(!c.provenAfter(a,1));
 mono+=180001;assert(!c.validTime(a,wall+7*3600000));assert(!c.validTime(b,wall-7*3600000));
});
test('expired and out-of-order proofs cannot roll a newer peer clock backward',()=>{
 let wall=1000000,mono=1;const c=new ClockProof({now:()=>wall,monotonic:()=>mono});const old=c.begin();mono=2;const fresh=c.begin();assert(c.accept(a,fresh,wall+25200000));assert(!c.accept(a,old,wall+99999999));assert(c.validTime(a,wall+25200000));
 const expired=c.begin();mono+=15001;assert(!c.accept(b,expired,wall-25200000));assert(!c.accept('invalid',c.begin(),wall));
});
test('probe reflection and clock metadata have bounded per-origin storage',()=>{
 let mono=1;const c=new ClockProof({now:()=>1000,monotonic:()=>mono});assert(c.shouldReply(a,'a'.repeat(32)));assert(!c.shouldReply(a,'a'.repeat(32)));mono+=1001;assert(c.shouldReply(a,'b'.repeat(32)));assert(!c.shouldReply(a,'bad'));
 for(let i=0;i<200;i++){mono+=1;const origin=i.toString(16).padStart(16,'0')+':1';c.accept(origin,c.begin(),1000+25200000);c.shouldReply(origin,'b'.repeat(32));}assert(c.peers.size<=128);assert(c.pending.size<=8);assert(c.requests.size<=128);
});
