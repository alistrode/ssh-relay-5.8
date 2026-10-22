'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.env.RELAY_APP_ROOT||path.join(__dirname,'../..'));
const {Agent}=require(path.join(root,'src/pro/agent.cjs'));
const {Client}=require(path.join(root,'node_modules/ssh2'));
const state=path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(),'relay-concurrent-'+crypto.randomUUID()));
if(fs.existsSync(state))throw Error('Use a fresh private state directory');
fs.mkdirSync(state,{recursive:true,mode:0o700});
const agents=[],clients=[],results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function record(name){results.push({name,passed:true});console.log(name);fs.writeFileSync(path.join(state,'results.json'),JSON.stringify(results,null,2));}
async function until(label,fn,ms=100000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(250)}throw Error('Timed out: '+label)}
async function agent(role,name){const a=new Agent({role,dir:path.join(state,name),allowCloudSelfTest:true});agents.push(a);await a.start();return a}
async function pair(n,f){const code=await f.createPair();await n.joinPair(code.code);return until('verified pair',()=>{const d=n.status().devices.find(d=>d.id===f.identity.deviceId);if(d?.state==='identity_error')throw Error(d.lastErrorCode||'identity error');return d?.state==='online'&&d})}
async function connect(n,id){const d=await until('ready device',()=>{const d=n.status().devices.find(x=>x.id===id);return d?.state==='online'&&d});const r=JSON.parse(fs.readFileSync(d.connectionReport));const c=new Client();clients.push(c);await new Promise((resolve,reject)=>{c.once('ready',resolve);c.on('error',reject);c.connect({host:'127.0.0.1',port:r.local_port,username:'relay',privateKey:fs.readFileSync(r.ssh_argv[r.ssh_argv.indexOf('-i')+1]),readyTimeout:60000,hostVerifier:key=>'SHA256:'+crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/,'')===r.host_fingerprint})});return c}
function exec(c,text){return new Promise((resolve,reject)=>c.exec(text,(e,s)=>{if(e)return reject(e);let out='',err='';s.on('data',b=>out+=b);s.stderr.on('data',b=>err+=b);s.on('error',reject);s.on('close',code=>code===0?resolve(out):reject(Error('command '+code+': '+err))) }))}
async function api(a,route,body){return require(path.join(root,'src/pro/agent-client.cjs')).request(a.dir,route,body)}
(async()=>{try{
const f=await agent('far','far'), ns=[];
for(let i=0;i<5;i++){const n=await agent('near','near'+i);ns.push(n);await pair(n,f);console.log('paired controller '+(i+1));}
await until('five controllers',()=>f.status().admission?.connectedControllerIds?.length===5);
const cs=[];for(const n of ns)cs.push(await connect(n,f.identity.deviceId));
const outputs=await Promise.all(cs.map((c,i)=>exec(c,process.platform==='win32'?`echo concurrent-${i}`:`sleep 1; printf concurrent-${i}`)));
outputs.forEach((o,i)=>assert(o.includes('concurrent-'+i)));record('five_near_ends_execute_simultaneously_without_takeover');
const sixth=await agent('near','near6');await pairCodeOnly(sixth,f);
await until('sixth refused',()=>sixth.status().devices[0]?.state==='remote_full');
assert.equal(f.status().admission.connectedControllerIds.length,5);record('sixth_controller_refused_without_disturbing_five');
const pending=await until('capacity request',()=>f.status().admission.pending.find(p=>p.controllerId===sixth.identity.deviceId));
await api(f,'/connection/decision',{requestId:pending.requestId,approve:true,replaceControllerId:ns[4].identity.deviceId});
await until('chosen sixth admitted',()=>sixth.status().devices[0]?.state==='online');
for(const i of [0,1,2,3])assert((await exec(cs[i],'echo unaffected')).includes('unaffected'));
assert.equal(f.status().devices.find(d=>d.id===ns[4].identity.deviceId).enabled,false);
record('explicit_sixth_replacement_disconnects_only_selected_controller');
await api(sixth,'/device',{id:f.identity.deviceId,enabled:false});
await api(f,'/controller',{id:ns[4].identity.deviceId,enabled:true});
await until('original fifth resumed',()=>ns[4].status().devices[0]?.state==='online');
cs[4]=await connect(ns[4],f.identity.deviceId);

await api(f,'/controller',{id:ns[1].identity.deviceId,enabled:false});
await until('scoped far disconnect',()=>!f.status().admission.connectedControllerIds.includes(ns[1].identity.deviceId));
for(const i of [0,2,3,4])assert((await exec(cs[i],'echo survivor')).includes('survivor'));record('far_side_disconnect_keeps_other_four_connections_working');
await api(sixth,'/device',{id:f.identity.deviceId,enabled:false});
await api(f,'/controller',{id:ns[1].identity.deviceId,enabled:true});
await until('reconnect saved controller',()=>ns[1].status().devices[0]?.state==='online');record('resume_retains_pairing');
for(let i=1;i<5;i++){cs[i].destroy();await ns[i].close();}
await sixth.close();
const fars=[f];
for(let i=1;i<5;i++){const other=await agent('far','far'+i);fars.push(other);await pair(ns[0],other);console.log('paired target '+(i+1));}
assert.equal(ns[0].status().devices.filter(d=>d.state==='online').length,5);
const targets=[];for(const far of fars)targets.push(await connect(ns[0],far.identity.deviceId));
const replies=await Promise.all(targets.map((c,i)=>exec(c,'echo target-'+i)));replies.forEach((s,i)=>assert(s.includes('target-'+i)));record('one_near_end_executes_on_five_targets_simultaneously');
const sixthFar=await agent('far','far6');await assert.rejects(()=>pairCodeOnly(ns[0],sixthFar),e=>e.code==='DEVICE_LIMIT_REACHED');record('sixth_target_refused');
await api(ns[0],'/device',{id:fars[1].identity.deviceId,enabled:false});
await until('near side disconnected',()=>ns[0].status().devices.find(d=>d.id===fars[1].identity.deviceId)?.state==='disconnected');
for(const i of [0,2,3,4])assert((await exec(targets[i],'echo retained')).includes('retained'));record('near_side_disconnect_keeps_other_four_targets_working');
// A real SFTP write/read through the unchanged transport.
const sftp=await new Promise((r,j)=>targets[0].sftp((e,s)=>e?j(e):r(s)));
const file=path.join(state,'payload.bin'),payload=crypto.randomBytes(8192);
await new Promise((r,j)=>{const w=sftp.createWriteStream(file);w.on('error',j);w.on('close',r);w.end(payload)});
const chunks=[];await new Promise((r,j)=>{const s=sftp.createReadStream(file);s.on('data',b=>chunks.push(b));s.on('end',r);s.on('error',j)});assert.deepEqual(Buffer.concat(chunks),payload);sftp.end();record('unchanged_sftp_roundtrip_hash_matches');
}catch(e){console.error(e.stack);fs.writeFileSync(path.join(state,'failure.txt'),e.stack);process.exitCode=1}finally{for(const c of clients)c.destroy();await Promise.allSettled(agents.map(a=>a.close()));console.log('isolated agents closed; results in '+state)}})();
async function pairCodeOnly(n,f){const offer=await f.createPair();await n.joinPair(offer.code)}
