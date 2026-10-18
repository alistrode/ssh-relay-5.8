"use strict";
// Two independently paired directions, cloud fixtures only. No existing reports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Agent}=require('../../src/pro/agent.cjs'),{request}=require('../../src/pro/cli.cjs'),{Client}=require('ssh2');
const windows=process.argv[2]==='--windows',root=path.resolve(process.argv[windows?4:2]),share=path.resolve(process.argv[3]);
if(fs.existsSync(root))throw Error('Use an isolated new cross-platform directory');fs.mkdirSync(root,{recursive:true});
const brokerUrl='wss://test.mosquitto.org:8081/mqtt',wait=ms=>new Promise(r=>setTimeout(r,ms));let far,near;
const file=name=>path.join(share,'cross-'+name),save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
async function until(fn,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){try{const x=fn();if(x)return x;}catch{}await wait(1000);}throw Error('Cross-platform fixture timeout');}
async function close(){await near?.close();await far?.close();}
process.once('SIGTERM',()=>close().then(()=>process.exit(130)));
async function verifiedCommand(report){const c=new Client();try{await new Promise((r,j)=>{c.once('ready',r);c.on('error',j);c.connect({host:'127.0.0.1',port:report.local_port,username:'relay',privateKey:fs.readFileSync(report.ssh_argv[report.ssh_argv.indexOf('-i')+1]),readyTimeout:60000,hostVerifier:k=>'SHA256:'+crypto.createHash('sha256').update(k).digest('base64').replace(/=+$/,'')===report.host_fingerprint});});const cmd=windows?'uname -s':'ver';return await new Promise((r,j)=>c.exec(cmd,(e,s)=>{if(e)return j(e);let out='';s.on('data',b=>out+=b);s.on('close',code=>code===0?r(out):j(Error('Native remote command failed')));s.on('error',j);}));}finally{c.destroy();}}
(async()=>{try{
 for(const role of ['far','near']){const a=new Agent({role,dir:path.join(root,role),brokerUrl,allowCloudSelfTest:false});await a.start();if(role==='far')far=a;else near=a;}
 const side=windows?'windows':'linux',other=windows?'linux':'windows';const offer=await request(path.join(root,'far'),'/pair/create',{});save(side+'-offer-private.json',{code:offer.code});
 const remoteOffer=await until(()=>JSON.parse(fs.readFileSync(file(other+'-offer-private.json'))));await request(path.join(root,'near'),'/pair/connect',{code:remoteOffer.code});
 const device=await until(()=>{const d=near.status().devices[0];return d?.state==='online'&&d;});const report=JSON.parse(fs.readFileSync(device.connectionReport));assert.equal(report.cloud_self_test,false);assert.equal(report.target,windows?'linux':'win10');
 const output=await verifiedCommand(report);assert(windows?output.includes('Linux'):output.includes('Windows'));save(side+'-result.json',{passed:true,target:report.target,remoteHostname:report.remote_hostname,remoteUser:report.remote_user,hostFingerprint:report.host_fingerprint,commandOutput:output.trim()});console.log('PASS '+side+' near -> '+other+' far native command and pinned identity');
 // Keep only this pair alive while the other direction finishes.
 await until(()=>fs.existsSync(file(other+'-result.json')));await wait(1000);
}catch(e){save((windows?'windows':'linux')+'-failure.json',{error:e.message});console.error(e.stack);process.exitCode=1;}finally{await close();}})();
