"use strict";
// Run the real cloud distribution without a display or Electron.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."),bundle=path.join(root,"run-output/SSHRelayPro-5.7-Cloud-Linux-x64"),profile=path.resolve(process.env.RUNNER_TEMP||path.join(root,"work"),"ssh-relay-cloud57"),env={...process.env};
delete env.DISPLAY;delete env.WAYLAND_DISPLAY;delete env.ELECTRON_RUN_AS_NODE;
const child=cp.spawn(path.join(bundle,"Start-Cloud.sh"),["--profile-dir",profile],{env,stdio:"inherit"});
const exited=new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",(code,signal)=>resolve({code,signal}));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ready=false;
  try{
    for(let i=0;i<120;i++){try{ready=JSON.parse(fs.readFileSync(path.join(profile,"cloud-runtime.json"),"utf8")).ready;}catch{}if(ready)break;if(child.exitCode!==null)throw Error("Cloud process exited during startup");await sleep(500);}
    if(!ready)throw Error("Cloud startup did not finish");
    const {request}=require(path.join(bundle,"release/app/src/pro/agent-client.cjs"));
    for(const role of ["near","far"]){const status=await request(path.join(profile,role),"/status");console.log(JSON.stringify({role:status.role,system:status.system,connectionLimit:status.connectionLimit,displayRequired:false}));}
  }finally{child.kill("SIGTERM");}
  const result=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error("Cloud shutdown did not finish")),45000).unref())]);
  if(result.code!==0)throw Error("Cloud exited unsuccessfully: "+JSON.stringify(result));
  console.log("Cloud distribution started both Agents and stopped without a graphical display.");
})().catch(error=>{console.error(error.message);child.kill("SIGTERM");process.exitCode=1;});
