"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),cp=require("node:child_process"),crypto=require("node:crypto");
const {read,write,folder}=require("./store.cjs"), lifecycle=require("./client-lifecycle.cjs");
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
const profile=path.resolve(arg("--profile-dir")),config=read(arg("--config-file"));
if(path.resolve(config.profile)!==profile)throw Error("Invalid client profile");
const lock=path.join(folder(profile),"client-supervisor.lock"),runtime=path.join(profile,lifecycle.runtimeName);
try{fs.mkdirSync(lock,{mode:0o700});}catch(error){
  if(error.code!=="EEXIST")throw error;
  const owner=read(path.join(lock,"owner.json"),{});
  if(lifecycle.alive(owner.pid))process.exit(0);
  fs.rmSync(lock,{recursive:true});fs.mkdirSync(lock,{mode:0o700});
}
write(path.join(lock,"owner.json"),{pid:process.pid});
let state={pid:process.pid,token:config.sessionToken||crypto.randomBytes(32).toString("hex"),desiredRunning:true,stopping:false,clientPid:null,heartbeatAt:Date.now(),generation:0};
let child,busy=false,timer,lastLaunch=0;
const save=()=>write(runtime,state);
function guiArgs(){return [...(config.args||[]),...(config.development?[config.appRoot]:[]),"--profile-dir",profile,"--managed-client"];}
function spawnGui(showOnly=false){
  const env={...process.env,SSH_RELAY_CLIENT_SESSION:state.token,SSH_RELAY_CLIENT_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const log=fs.openSync(path.join(profile,"client-process.log"),"a",0o600);
  const proc=cp.spawn(config.executable,guiArgs(),{env,windowsHide:false,stdio:["ignore",log,log]});
  fs.closeSync(log);
  proc.once("error",()=>{if(child===proc)state.clientPid=null;});
  if(showOnly){proc.unref();return;}
  child=proc;state.clientPid=proc.pid||null;state.heartbeatAt=Date.now();state.generation++;lastLaunch=Date.now();save();
  proc.once("exit",()=>{if(child===proc){child=null;state.clientPid=null;save();}});
}
const server=http.createServer(async(req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
  if(req.headers.origin||req.method!=="POST"||req.headers.authorization!=="Bearer "+state.token)return reply(401,{error:"Unauthorized"});
  let body="";
  try{
    for await(const chunk of req){body+=chunk;if(body.length>2000)throw Error("Request too large");}
    const data=JSON.parse(body||"{}");
    if(req.url==="/heartbeat"){
      if(data.pid!==state.clientPid||!state.desiredRunning||state.stopping)throw Error("Client session changed");
      state.heartbeatAt=Date.now();save();return reply(200,{ok:true,generation:state.generation});
    }
    if(req.url==="/show"){if(state.desiredRunning&&!state.stopping)spawnGui(true);return reply(200,{ok:true});}
    if(req.url==="/tray-exit"){
      if(data.pid!==state.clientPid)throw Error("Only the current client can exit from its tray");
      state.stopping=true;save();
      try{await lifecycle.stopBackends(profile,state.clientPid);}catch(error){state.stopping=false;save();throw error;}
      state.desiredRunning=false;save();return reply(200,{ok:true,backendsStopped:true});
    }
    reply(404,{error:"Unknown client action"});
  }catch(error){reply(400,{error:error.message});}
});
async function loop(){
  if(busy)return;busy=true;
  try{
    if(!state.desiredRunning){
      if(!lifecycle.alive(state.clientPid)){await lifecycle.stopBackends(profile,state.clientPid);clearInterval(timer);server.close();fs.rmSync(runtime,{force:true});fs.rmSync(lock,{recursive:true,force:true});process.exit(0);}
      return;
    }
    if(state.stopping)return;
    if(!lifecycle.alive(state.clientPid)){
      await lifecycle.stopBackends(profile,state.clientPid);
      if(Date.now()-lastLaunch<2000)return;
      spawnGui();
    }
  }catch(error){console.error("Client recovery:",error.message);}
  finally{busy=false;}
}
server.listen(0,"127.0.0.1",async()=>{
  state.port=server.address().port;
  if(config.adoptPid&&lifecycle.alive(config.adoptPid)){state.clientPid=config.adoptPid;state.heartbeatAt=Date.now();}
  save();
  // Let the short-lived launcher release Electron resources before starting the client.
  if(config.bootstrapPid)for(let n=0;n<100&&lifecycle.alive(config.bootstrapPid);n++)await new Promise(resolve=>setTimeout(resolve,100));
  timer=setInterval(()=>void loop(),1000);void loop();
});
// An external signal is not an intentional tray exit. The client heartbeat will
// replace this supervisor; its active session token and desired state survive.
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>process.exit(1));
