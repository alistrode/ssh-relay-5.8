// Isolated public-relay cloud self-test; never uses an existing profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Agent}=require('../../src/pro/agent.cjs');
const dir=path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(),'pairing-full-day-'+require('node:crypto').randomUUID()));
if(fs.existsSync(dir))throw Error('Fresh state required');
const agents=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function make(role,name){const a=new Agent({role,dir:path.join(dir,name),allowCloudSelfTest:true});agents.push(a);await a.start();return a;}
async function online(a,id){const end=Date.now()+90000;while(Date.now()<end){const d=a.status().devices.find(d=>d.id===id);if(d?.state==='online')return;await sleep(250);}throw Error('Not online');}
(async()=>{try{
let far=await make('far','far');const first=await far.createPair();
for(let i=0;i<2;i++){const n=await make('near','near'+i);await n.joinPair(first.code);await online(n,far.identity.deviceId);}
const newer=await far.createPair();const third=await make('near','near2');await third.joinPair(first.code);await online(third,far.identity.deviceId);
await far.close();far=await make('far','far');
const fourth=await make('near','near3');await fourth.joinPair(first.code);await online(fourth,far.identity.deviceId);
assert([...far.pairOffers].some(o=>o.code===first.code&&o.expiresAt===first.expiresAt));
assert([...far.pairOffers].some(o=>o.code===newer.code&&o.expiresAt===newer.expiresAt));
console.log('PASS actual Agents over public relay: same old code pairs four near ends across new-code creation and far restart; original expiry preserved');
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,sameCodeMultipleNearEnds:true,newCodePreservesOld:true,restartPreservesOriginalExpiry:true}));
}finally{await Promise.allSettled(agents.map(a=>a.close()));}})().catch(e=>{console.error(e);process.exitCode=1;});
