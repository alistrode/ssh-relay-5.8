"use strict";
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), cp = require("node:child_process");
const { read, write, folder } = require("./store.cjs");
const runtimeName = "client-runtime.json";
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0);
    if(process.platform==="linux"){const stat=fs.readFileSync("/proc/"+pid+"/stat","utf8");if(stat.slice(stat.lastIndexOf(")")+2).startsWith("Z "))return false;}
    return true; } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'client-lifecycle.cjs',line:9}); return error.code === "EPERM"; }
}
function clientState(profile) { return read(path.join(profile, runtimeName), null); }
function profileFor(dir) {
  return read(path.join(dir, "client-owner.json"), null)?.profile || path.dirname(path.resolve(dir));
}
function clientActive(dir) {
  try {
    const profile = require("./release.cjs").requireProfile(profileFor(dir)), state = clientState(profile);
    return !!(state?.desiredRunning && !state.stopping && alive(state.clientPid) && Date.now() - state.heartbeatAt < 15000);
  } catch (caughtFailure) { require('./runtime-log.cjs').captureCaught(caughtFailure,{component:'client-lifecycle.cjs',line:19}); return false; }
}
function command(profile, action, extra = {}) {
  const state = clientState(profile);
  if (!state || !alive(state.pid)) return Promise.reject(Error("客户端守护未启动"));
  return new Promise((resolve, reject) => {
    const req = http.request({ host:"127.0.0.1", port:state.port, path:"/"+action, method:"POST",
      headers:{Authorization:"Bearer "+state.token,"Content-Type":"application/json"}, timeout:45000 }, res => {
      let data=""; res.on("data", chunk => { data += chunk; }); res.on("end", () => {
        try { const value=JSON.parse(data); res.statusCode===200 ? resolve(value) : reject(Error(value.error || "客户端操作失败")); } catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'client-lifecycle.cjs',line:28});reject(error);}
      });
    });
    req.on("error",reject); req.on("timeout",()=>req.destroy(Error("客户端操作超时")));
    req.end(JSON.stringify(extra));
  });
}
async function launch(options) {
  const profile = require("./release.cjs").requireProfile(options.profile,{create:true});
  let state; try { state=clientState(profile); } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'client-lifecycle.cjs',line:37}); }
  if (state && alive(state.pid) && state.desiredRunning) {
    if (!options.adoptPid) await command(profile,"show");
    return state;
  }
  const config = { ...options, profile };
  const configFile=path.join(profile,"client-launch.json"); write(configFile,config);
  const log=fs.openSync(path.join(profile,"client-supervisor.log"),"a",0o600);
  try {
    const child=cp.spawn(options.executable,[path.join(options.appRoot,"src/pro/client-supervisor.cjs"),"--profile-dir",profile,"--config-file",configFile],{
      detached:true,stdio:["ignore",log,log],windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},
    });
    await new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});child.unref();
  } finally { fs.closeSync(log); }
  for(let n=0;n<100;n++) {
    await new Promise(resolve=>setTimeout(resolve,100));
    try { state=clientState(profile);if(state?.desiredRunning && alive(state.pid))return state; } catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'client-lifecycle.cjs',line:53}); }
  }
  throw Error("客户端守护启动失败，已停止独立后台启动");
}
async function requireClient(dir) {
  if (clientActive(dir)) return;
  const profile=require("./release.cjs").requireProfile(profileFor(dir),{create:true}), appRoot=path.resolve(__dirname,"../..");
  let options=read(path.join(profile,"client-launch.json"),null);
  if(!options) {
    let executable;
    if(process.versions.electron) executable=process.execPath;
    else {
      const native=path.resolve(appRoot,"../..",process.platform==="win32"?"SSHRelayPro.exe":"ssh-relay-pro");
      executable=fs.existsSync(native)?native:require("electron");
    }
    options={profile,appRoot,executable,development:!fs.existsSync(path.join(path.dirname(executable),"resources/app")),args:[]};
  }
  await launch({...options,adoptPid:undefined,sessionToken:undefined,bootstrapPid:undefined});
  for(let n=0;n<200;n++){if(clientActive(dir))return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error("必须先启动客户端，禁止独立后台运行");
}
async function processList() {
  if(process.platform==="win32") {
    const script="Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
    return new Promise((resolve,reject)=>cp.execFile("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024,timeout:20000},(err,stdout)=>{
      if(err)return reject(err);try{resolve([JSON.parse(stdout)].flat().map(p=>({pid:p.ProcessId,ppid:p.ParentProcessId,command:p.CommandLine||""})));}catch (error) { require('./runtime-log.cjs').captureCaught(error,{component:'client-lifecycle.cjs',line:78});reject(error);}
    }));
  }
  const rows=[];
  for(const pid of fs.readdirSync("/proc").filter(p=>/^\d+$/.test(p)))try{
    const stat=fs.readFileSync("/proc/"+pid+"/stat","utf8"), fields=stat.slice(stat.lastIndexOf(")")+2).split(" ");
    if(fields[0]!=="Z")rows.push({pid:Number(pid),ppid:Number(fields[1]),command:fs.readFileSync("/proc/"+pid+"/cmdline").toString().replace(/\0/g," ")});
  }catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'client-lifecycle.cjs',line:85}); }
  return rows;
}
async function stopBackends(profile, clientPid) {
  const normalize=s=>process.platform==="win32"?s.replace(/\\/g,"/").toLowerCase():s;
  const prefix=normalize(path.resolve(profile));
  const includeUi = !alive(clientPid);
  const known = /\/(?:guardian|agent|worker|task-runner|session-runner|file-worker)\.cjs(?:["\s]|$)/;
  let last=[];
  for(let round=0;round<8;round++) {
    const rows=await processList(), selected=new Set();
    for(const p of rows) {
      const command=normalize(p.command);
      if(p.pid!==process.pid && p.pid!==clientPid && command.includes(prefix) && (known.test(command) || (includeUi && /--type=|crashpad.handler/.test(command))))selected.add(p.pid);
    }
    // Include the Electron-owned backend tree while preserving Chromium/UI children.
    let changed=true;
    while(changed){changed=false;for(const p of rows)if(selected.has(p.ppid)&&!selected.has(p.pid)){selected.add(p.pid);changed=true;}}
    last=rows.filter(p=>selected.has(p.pid));
    if(!last.length)return;
    for(const p of last.reverse()) {
      if(process.platform==="win32")await new Promise(resolve=>cp.execFile("taskkill.exe",["/PID",String(p.pid),"/T","/F"],{windowsHide:true,timeout:10000},()=>resolve()));
      else try{process.kill(p.pid,round<2?"SIGTERM":"SIGKILL");}catch (caughtError) { require('./runtime-log.cjs').captureCaught(caughtError,{component:'client-lifecycle.cjs',line:107}); }
    }
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw Error("部分后台进程尚未退出，客户端继续保留以便清理");
}
module.exports={alive,clientState,clientActive,profileFor,command,launch,requireClient,processList,stopBackends,runtimeName};
