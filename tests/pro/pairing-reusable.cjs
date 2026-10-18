"use strict";
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {offer,join}=require('../../src/pro/pairing.cjs'),{keyPair}=require('../../src/pro/keys.cjs');
const broker=process.env.RELAY_LAB_BROKER;
if(!broker)throw Error('Set RELAY_LAB_BROKER to an isolated test broker');
const who=()=>({deviceId:crypto.randomUUID(),publicKey:keyPair().publicKey});
(async()=>{
 let count=0;const live=await offer({broker,info:{deviceId:crypto.randomUUID()},reusable:true,ttl:60000,authorize:async()=>({deviceId:crypto.randomUUID(),session:String(++count)})});
 try{
  const connect=()=>join({broker,code:live.code,who:who(),accept:async()=>{},timeout:20000});
  const first=await connect();await new Promise(r=>setTimeout(r,3500));assert(live.active,'A receipt must not consume a reusable code');
  const next=await Promise.all([connect(),connect()]);assert.equal(new Set([first.session,...next.map(v=>v.session)]).size,3);assert(live.active);
  await assert.rejects(()=>join({broker,code:live.code.slice(0,-1)+(live.code.endsWith('2')?'3':'2'),who:who(),accept:async()=>{},timeout:2500}));
  console.log('PASS reusable code: sequential and concurrent clients have distinct assigned sessions; receipt keeps invitation open; wrong code rejected');
 }finally{live.cancel();}
})().catch(e=>{console.error(e);process.exitCode=1;});
