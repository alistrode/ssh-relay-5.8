"use strict";
// A reusable short invitation assigns a fresh MQTT channel on every invocation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {join}=require('../src/pro/pairing.cjs'),{keyPair}=require('../src/pro/keys.cjs');
(async()=>{
 const code=process.argv[2],root=path.resolve(process.argv[3]||path.join(os.homedir(),'.relay-shared'));
 if(!code)throw Error('Usage: node scripts/shared-connect.cjs CODE [private-state-directory]');
 const keys=keyPair('shared-client');
 const info=await join({broker:'wss://test.mosquitto.org:8081/mqtt',code,who:{deviceId:crypto.randomUUID(),publicKey:keys.publicKey,label:'Shared VM client'},accept:async()=>{}});
 if(info.version!==1||info.user!=='relay'||!/^[a-f0-9]{32}$/.test(info.session)||!/^[a-f0-9]{64}$/.test(info.secret)||info.broker!=='wss://test.mosquitto.org:8081/mqtt')throw Error('Invalid shared endpoint');
 const fingerprint='SHA256:'+crypto.createHash('sha256').update(Buffer.from(info.hostPublicKey.split(/\s+/)[1],'base64')).digest('base64').replace(/=+$/,'');
 if(fingerprint!==info.fingerprint)throw Error('Invalid host fingerprint');
 const dir=path.join(root,info.session);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const save=(name,data)=>fs.writeFileSync(path.join(dir,name),data,{mode:0o600,flag:'wx'});
 save('client_key',info.clientPrivateKey);save('known_hosts','relay-'+info.session+' '+info.hostPublicKey+'\n');
 save('near.json',JSON.stringify({...info,clientPrivateKey:undefined,localPort:0,runtimePath:path.join(dir,'runtime.json'),statusPath:path.join(dir,'peer.json')}));
 const log=fs.openSync(path.join(dir,'near.log'),'a',0o600);
 const child=cp.spawn(process.execPath,[path.resolve(__dirname,'../src/near.cjs'),path.join(dir,'near.json')],{detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let runtime,peer;
 for(let i=0;i<120;i++){try{runtime=JSON.parse(fs.readFileSync(path.join(dir,'runtime.json')));peer=JSON.parse(fs.readFileSync(path.join(dir,'peer.json')));if(peer.fingerprint===fingerprint)break;}catch{}await wait(1000);}
 if(!runtime||peer?.fingerprint!==fingerprint)throw Error('Assigned channel did not become ready; private state: '+dir);
 const argv=['ssh','-F',os.devNull,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+path.join(dir,'known_hosts'),'-o','HostKeyAlias=relay-'+info.session,'-o','ConnectTimeout=25','-i',path.join(dir,'client_key'),'-p',String(runtime.port),'relay@127.0.0.1'];
 const verified=cp.spawnSync(argv[0],argv.slice(1).concat('hostname'),{encoding:'utf8',timeout:45000});
 if(verified.status!==0||verified.stdout.trim()!=='relay-win10-management')throw Error('Pinned management identity verification failed');
 const report={connected:true,remote_hostname:verified.stdout.trim(),host_fingerprint:fingerprint,ssh_argv:argv,state_directory:dir};save('connection.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({connected:true,report:path.join(dir,'connection.json'),console:'Use ssh_argv with -N -L 127.0.0.1:38006:127.0.0.1:28006; then open http://127.0.0.1:38006'},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
