"use strict";
// Operate the real desktop application on a GitHub runner. No test suite,
// fixtures, network fault injection or simulated devices are created.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."),profile=path.join(root,"work/github-client"),output=path.join(root,"run-output");
require("../src/pro/release.cjs").requireProfile(profile,{create:true});fs.mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record={release:"5.5",platform:process.platform,startedAt:new Date().toISOString(),operations:[]};
function save(){fs.writeFileSync(path.join(output,"run.json"),JSON.stringify(record,null,2)+"\n");}
async function waitFor(fn,ms=120000){const until=Date.now()+ms;let last;while(Date.now()<until){try{const value=await fn();if(value)return value;}catch(error){last=error;}await sleep(500);}throw last||Error("Application startup did not finish");}
async function connectInspector(port,select){
  const target=await waitFor(async()=>{const pages=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();return pages.find(select);});
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map();
  socket.onmessage=event=>{const value=JSON.parse(event.data),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(Error(value.error.message)):item.resolve(value.result);}};
  socket.onclose=()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error("Application inspector closed"));}pending.clear();};
  return {socket,call:(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error("Application operation timed out"));},45000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));})};
}
let renderer,main;
(async()=>{
  const executable=require("electron"),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const launcher=cp.spawn(executable,["--inspect=9230","--remote-debugging-port=9222",root,"--profile-dir",profile,"--no-shortcuts"],{env,stdio:["ignore","pipe","pipe"],windowsHide:false});
  const log=fs.createWriteStream(path.join(profile,"launch-private.log"));launcher.stdout.pipe(log);launcher.stderr.pipe(log);
  launcher.on("error",error=>{record.launchError=error.message;save();});
  renderer=await connectInspector(9222,page=>page.type==="page"&&page.url.endsWith("desktop/index.html"));
  const evaluate=async expression=>{const value=await renderer.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.text+": "+JSON.stringify(value.exceptionDetails.exception?.description));return value.result?.value;};
  await waitFor(()=>evaluate('Promise.all([window.relay.call("near","/status"),window.relay.call("far","/status")]).then(s=>s.map(v=>({role:v.role,system:v.system,connectionLimit:v.connectionLimit})))'));
  record.devices=await evaluate('Promise.all([window.relay.call("near","/status"),window.relay.call("far","/status")]).then(s=>s.map(v=>({role:v.role,system:v.system,connectionLimit:v.connectionLimit})))');record.operations.push("client_and_both_connection_services_started");save();console.log("Client and both connection services are running.");
  await evaluate('Promise.all([window.relay.call("near","/settings",{enabled:true}),window.relay.call("far","/settings",{enabled:true})])');
  await sleep(4000);
  record.screen=await evaluate('({title:document.title,localSystem:document.getElementById("localSystem").textContent,nearCapacity:document.getElementById("nearCount").textContent,farCapacity:document.getElementById("farCount").textContent,buttonCount:document.querySelectorAll("button").length})');
  const capture=await renderer.call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});fs.writeFileSync(path.join(output,"client.png"),Buffer.from(capture.data,"base64"));record.operations.push("desktop_opened_with_system_version_and_twenty_device_controls");save();console.log("Desktop screenshot saved; closing through the tray exit handler.");
  main=await connectInspector(9230,()=>true);
  // Invoke the exact internal handler installed on the tray's sole Exit item.
  const expression="void process.getBuiltinModule(\"module\").createRequire("+JSON.stringify(path.join(root,"package.json"))+")("+JSON.stringify(path.join(root,"desktop/main.cjs"))+").trayExit()";
  try{const value=await main.call("Runtime.evaluate",{expression,awaitPromise:false,returnByValue:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);}catch(error){if(!/inspector closed/.test(error.message))throw error;}
  main.socket.close();renderer.socket.close();
  await waitFor(()=>!fs.existsSync(path.join(profile,"client-runtime.json")),45000);
  record.operations.push("tray_exit_handler_closed_client_and_owned_backends");record.finishedAt=new Date().toISOString();record.completed=true;save();
  renderer.socket.close();main.socket.close();console.log(JSON.stringify(record,null,2));
})().catch(async error=>{
  record.completed=false;record.error=error.message;
  record.failureDiagnostics=[];
  for(const name of ["launch-private.log","client-process.log","client-supervisor.log"])try{
    const lines=fs.readFileSync(path.join(profile,name),"utf8").split("\n");
    record.failureDiagnostics.push(...lines.filter(line=>/Error:|FATAL|SUID|sandbox|shared libraries|Missing X|display|TypeError|failed to/i.test(line)).slice(-12).map(line=>line.replace(/[a-f0-9]{32,}/gi,"[private-id]").slice(0,700)));
  }catch{}
  save();console.error(error.message);console.error(record.failureDiagnostics.join("\n"));
  try{const lifecycle=require("../src/pro/client-lifecycle.cjs"),state=lifecycle.clientState(profile);if(state?.clientPid)await lifecycle.command(profile,"tray-exit",{pid:state.clientPid});}catch{}
  renderer?.socket.close();main?.socket.close();process.exitCode=1;
});
