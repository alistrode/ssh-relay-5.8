"use strict";
// Isolated identities only; sample real SSH/SFTP and recover this fixture's worker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),assert=require('node:assert/strict');
const appRoot=process.env.RELAY_TEST_APP_ROOT||path.resolve(__dirname,'../..');
const {Agent}=require(path.join(appRoot,'src/pro/agent.cjs')),{request}=require(path.join(appRoot,'src/pro/cli.cjs')),{Client}=require(path.join(appRoot,'node_modules/ssh2'));
const root=path.resolve(process.argv[2]||path.join(os.tmpdir(),'relay-soak-'+crypto.randomUUID())),seconds=Number(process.argv[3]||3600);
if(fs.existsSync(root)||!Number.isFinite(seconds)||seconds<60)throw Error('Use a new isolated directory and at least 60 seconds');
fs.mkdirSync(root,{recursive:true,mode:0o700});const wait=ms=>new Promise(r=>setTimeout(r,ms));let far,near,samples=0,recovered=0;const started=Date.now();let sourceHash;
function save(state){fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({state,platform:process.platform,started:new Date(started).toISOString(),elapsedSeconds:(Date.now()-started)/1000,requiredSeconds:seconds,samples,recovered,sourceHash},null,2));}
async function until(fn,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const x=fn();if(x)return x;await wait(500);}throw Error('Fixture failed to become verified online');}
async function sample(report){
 const client=new Client(),key=report.ssh_argv[report.ssh_argv.indexOf('-i')+1];
 try{
  await new Promise((resolve,reject)=>{client.once('ready',resolve);client.on('error',reject);client.connect({host:'127.0.0.1',port:report.local_port,username:'relay',privateKey:fs.readFileSync(key),readyTimeout:45000,hostVerifier:k=>'SHA256:'+crypto.createHash('sha256').update(k).digest('base64').replace(/=+$/,'')===report.host_fingerprint});});
  const token=crypto.randomBytes(12).toString('hex'),command=process.platform==='win32'?'echo '+token:'printf '+token;
  const result=await new Promise((resolve,reject)=>client.exec(command,(error,s)=>{if(error)return reject(error);let out='';s.on('data',b=>out+=b);s.on('error',reject);s.on('close',code=>code===0?resolve(out):reject(Error('Command failed')));}));assert.equal(result.trim(),token);
  const sftp=await new Promise((resolve,reject)=>client.sftp((e,s)=>e?reject(e):resolve(s)));const file=path.join(root,'transfer.bin'),data=crypto.randomBytes(65536);
  await new Promise((resolve,reject)=>{const stream=sftp.createWriteStream(file);stream.on('error',reject);stream.on('close',resolve);stream.end(data);});
  const read=await new Promise((resolve,reject)=>{const a=[],stream=sftp.createReadStream(file);stream.on('data',b=>a.push(b));stream.on('error',reject);stream.on('end',()=>resolve(Buffer.concat(a)));});assert(read.equals(data));sftp.end();
 }finally{client.destroy();}
}
(async()=>{try{
 const hash=crypto.createHash('sha256');for(const dir of ['src','desktop','launchers']){const walk=d=>{for(const name of fs.readdirSync(d).sort()){const p=path.join(d,name);if(fs.statSync(p).isDirectory())walk(p);else{hash.update(path.relative(appRoot,p));hash.update(fs.readFileSync(p));}}};walk(path.join(appRoot,dir));}sourceHash=hash.digest('hex');
 for(const role of ['far','near']){const a=new Agent({role,dir:path.join(root,role),allowCloudSelfTest:true,brokerUrl:process.env.RELAY_LAB_BROKER});await a.start();if(role==='far')far=a;else near=a;}
 const offer=await request(path.join(root,'far'),'/pair/create',{});await request(path.join(root,'near'),'/pair/connect',{code:offer.code});
 const online=()=>{const d=near.status().devices[0];return d?.state==='online'&&d;};
 const deadline=Date.now()+seconds*1000;let reset=false;
 while(Date.now()<deadline){const device=await until(online);await sample(JSON.parse(fs.readFileSync(device.connectionReport)));samples++;save('running');
  if(!reset&&samples>=3){reset=true;const owned=far.children.get('far');assert(owned);owned.child.kill('SIGTERM');await until(()=>!online(),30000);await until(online);recovered++;save('running');}
  await wait(Math.min(15000,Math.max(0,deadline-Date.now())));
 }
 assert(recovered===1&&samples>=3);save('passed');console.log('PASS isolated '+process.platform+' stability',JSON.stringify({samples,recovered,seconds}));
}catch(e){save('failed');fs.writeFileSync(path.join(root,'failure.txt'),e.stack);console.error(e.stack);process.exitCode=1;}finally{await near?.close();await far?.close();}})();
