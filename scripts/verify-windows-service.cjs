'use strict';
// Native Windows validation of the actual packaged service and desktop.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(process.platform!=='win32')throw Error('Requires native Windows');
const packaged=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]||'work/native-results');
fs.mkdirSync(out,{recursive:true});
const appRoot=path.join(packaged,'resources/app'),executable=path.join(packaged,'SSHRelayPro.exe');
const {folder,write,read}=require(path.join(appRoot,'src/pro/store.cjs'));
const startup=require(path.join(appRoot,'src/pro/autostart.cjs'));
const {request,ensureAgent}=require(path.join(appRoot,'src/pro/agent-client.cjs'));
const profile=folder(path.join(os.homedir(),'.ssh-relay-5.1-native-'+Date.now()));
const results=[];let ui;
function record(name,details={}){results.push({name,passed:true,...details});fs.writeFileSync(path.join(out,'windows-service-results.json'),JSON.stringify(results,null,2));console.log(name)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+60000;let last;while(Date.now()<end){try{const x=await fn();if(x)return x}catch(e){last=e}await sleep(300)}throw Error('Native readiness timeout: '+(last?.message||'condition not met'))}
async function cdp(){const pages=await(await fetch('http://127.0.0.1:9333/json/list')).json();const target=pages.find(p=>p.type==='page');if(!target)return null;const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const p=JSON.parse(e.data);if(p.id){const w=pending.get(p.id);pending.delete(p.id);p.error?w.reject(Error(JSON.stringify(p.error))):w.resolve(p.result)}};return{ws,call:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}}
(async()=>{try{
for(const role of ['near','far'])write(path.join(profile,role,'settings.json'),{enabled:false,autoConnect:true,label:'native-'+role});
const options={executable,appRoot,profile,development:false};
const state=await startup.apply(options,{enabled:true,mode:'boot'});
assert(state.bootInstalled);assert(state.servicesRunning);record('both_SYSTEM_services_installed_and_running');
const before={};for(const role of ['near','far']){await until(()=>request(path.join(profile,role),'/status'));before[role]=read(path.join(profile,role,'agent-runtime.json')).pid;}
for(const role of ['near','far']){
 const client=await ensureAgent({role,profileDir:profile});await client.request('GET','/status');
 assert.equal(read(path.join(profile,role,'agent-runtime.json')).pid,before[role]);
}
record('desktop_client_reuses_service_agents_without_unprivileged_fallback');
const owners=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$a=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-near'\";$b=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-far'\";@($a.StartName,$b.StartName)|ConvertTo-Json"],{encoding:'utf8'});
assert.deepEqual(JSON.parse(owners.stdout),['LocalSystem','LocalSystem']);record('native_SCM_confirms_LocalSystem_identity');
for(const role of ['near','far'])await request(path.join(profile,role),'/settings',{enabled:true});
await until(async()=>{const s=await request(path.join(profile,'far'),'/status');return s.workerPid&&s.admission});
record('service_role_switches_enable_both_backgrounds');
for(const role of ['near','far'])await request(path.join(profile,role),'/settings',{enabled:false});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
ui=cp.spawn(executable,['--profile-dir',profile,'--no-shortcuts','--remote-debugging-port=9333'],{env,stdio:'ignore'});
const debug=await until(cdp);
const evalJS=async expression=>{const r=await debug.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
await until(async()=>{return await evalJS('document.getElementById("refreshState")?.textContent.includes("后台在线")')});
let view=await evalJS('({near:document.getElementById("nearState").textContent,far:document.getElementById("farState").textContent,service:document.getElementById("serviceStatus").textContent,installDisabled:document.getElementById("installService").disabled})');
assert(view.near.includes('已关闭'));assert(view.far.includes('已关闭'));assert(view.installDisabled);record('packaged_desktop_connects_to_services_and_restores_saved_switches',view);
for(const role of ['near','far'])assert.equal(read(path.join(profile,role,'agent-runtime.json')).pid,before[role]);
await evalJS('(async()=>{await window.relay.call("near","/settings",{enabled:true});await window.relay.call("far","/settings",{enabled:true});await refresh();await document.fonts.ready;return true})()');
await debug.call('Emulation.setDeviceMetricsOverride',{width:1060,height:1400,deviceScaleFactor:1,mobile:false});
const shot=await debug.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,'windows-unified.png'),Buffer.from(shot.data,'base64'));
record('real_Windows_desktop_screenshot_captured');
await evalJS('location.reload();true');
await until(async()=>await evalJS('document.getElementById("nearState")?.textContent.includes("已开启") && document.getElementById("farState")?.textContent.includes("已允许连接")'));
record('both_UI_switches_persist_after_reload_without_UAC');debug.ws.close();
// Reboot-equivalent SCM restart: services read the same persisted profile.
for(const role of ['near','far'])await request(path.join(profile,role),'/settings',{enabled:false});
const restart=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Restart-Service SSHRelayPro-near,SSHRelayPro-far -ErrorAction Stop"],{encoding:'utf8',timeout:60000});assert.equal(restart.status,0,restart.stderr);
for(const role of ['near','far']){await until(()=>request(path.join(profile,role),'/status'));const s=await request(path.join(profile,role),'/status');assert.equal(s.settings.enabled,false);}
record('SCM_restart_keeps_saved_role_choices');
 }catch(e){
const details=[];
for(const role of ['near','far']) {
 for(const file of ['guardian-events.jsonl','agent-events.jsonl','bootstrap.log']) {
  const p=path.join(profile,role,file);
  if(fs.existsSync(p))details.push(role+'/'+file+'\n'+fs.readFileSync(p,'utf8').slice(-6000));
 }
 const logs=path.join(profile,'services');
 if(fs.existsSync(logs))for(const file of fs.readdirSync(logs).filter(n=>n.startsWith('SSHRelayPro-'+role)&&n.endsWith('.log')))
  details.push(file+'\n'+fs.readFileSync(path.join(logs,file),'utf8').slice(-6000));
}
fs.writeFileSync(path.join(out,'service-startup-diagnostics.txt'),details.join('\n\n'));
console.error(details.join('\n\n'));
fs.writeFileSync(path.join(out,'failure.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{
if(ui)cp.spawnSync('taskkill.exe',['/PID',String(ui.pid),'/T','/F'],{stdio:'ignore'});
cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Stop-Service SSHRelayPro-near,SSHRelayPro-far -ErrorAction SilentlyContinue;sc.exe delete SSHRelayPro-near;sc.exe delete SSHRelayPro-far"],{stdio:'ignore',timeout:60000});
}})();
