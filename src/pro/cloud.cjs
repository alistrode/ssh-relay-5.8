"use strict";
// 仅限云端下载使用。桌面发行包不允许独立后台。
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const lifecycle=require("./client-lifecycle.cjs"),{read,write,folder}=require("./store.cjs");
if(!lifecycle.cloudEdition)throw Error("请下载标注“仅限云端下载使用”的纯云端包；桌面版不允许纯后台");
const args=process.argv.slice(2),at=args.lastIndexOf("--profile-dir"),profile=path.resolve(at<0?path.join(os.homedir(),".ssh-relay-pro-5.5-cloud"):args[at+1]);
require("./release.cjs").requireProfile(profile,{create:true});
const runtime=path.join(profile,"cloud-runtime.json"),lock=path.join(profile,"cloud.lock"),previous=read(runtime,null);
if(args[0]==="stop"){
  if(lifecycle.ownerAlive(profile,previous)){process.kill(previous.pid,"SIGTERM");console.log("已请求停止纯云端实例");}
  else console.log("纯云端实例未运行");
}else{
  if(previous&&lifecycle.ownerAlive(profile,previous))throw Error("该纯云端实例已经运行");
  try{fs.mkdirSync(lock,{mode:0o700});}catch(error){
    if(error.code!=="EEXIST")throw error;
    const owner=read(path.join(lock,"owner.json"),null);
    if(lifecycle.ownerAlive(profile,owner)||Date.now()-fs.statSync(lock).mtimeMs<5000)throw Error("纯云端实例正在启动");
    fs.rmSync(lock,{recursive:true});fs.mkdirSync(lock,{mode:0o700});
  }
  const generation=crypto.randomUUID();write(path.join(lock,"owner.json"),{pid:process.pid});
  let stopping=false,timer,ready=false;
  function heartbeat(ready){write(runtime,{pid:process.pid,generation,desiredRunning:true,ready,heartbeatAt:Date.now(),edition:"cloud"});}
  async function stop(code=0){
    if(stopping)return;stopping=true;clearInterval(timer);
    write(runtime,{pid:process.pid,generation,desiredRunning:false,heartbeatAt:Date.now(),edition:"cloud"});
    try{await lifecycle.stopBackends(profile,process.pid);}catch(error){console.error(error.message);code=1;}
    if(read(runtime,null)?.generation===generation){fs.unlinkSync(runtime);fs.rmSync(lock,{recursive:true,force:true});}
    process.exitCode=code;
  }
  for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>void stop());
  heartbeat(false);timer=setInterval(()=>heartbeat(ready),1000);
  (async()=>{
    const {ensure}=require("./agent-client.cjs");
    for(const role of ["near","far"]){
      if(stopping)return;
      const dir=folder(path.join(profile,role));write(path.join(dir,"client-owner.json"),{profile});
      if(!fs.existsSync(path.join(dir,"settings.json")))write(path.join(dir,"settings.json"),{enabled:true,autoConnect:true,label:os.hostname(),defaultDevice:null});
      await ensure({dir,role});
    }
    if(!stopping){ready=true;heartbeat(true);console.log("SSH Relay Pro 5.5 Cloud 已启动（仅限云端下载使用，无图形界面）。Ctrl+C 或 Stop-Cloud.sh 停止。");}
  })().catch(error=>{console.error(error.message);void stop(1);});
}
