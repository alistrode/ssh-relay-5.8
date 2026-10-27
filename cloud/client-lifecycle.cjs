"use strict";
// 仅限云端下载使用。仅在纯云端包中替换客户端生命周期模块，桌面包不使用此模块。
const fs=require("node:fs"),path=require("node:path");
const base=require("./desktop-lifecycle.cjs"),{read}=require("./store.cjs");
if(process.platform!=="linux"||require("./release.cjs").EDITION!=="cloud")throw Error("仅限 Linux 云端使用");
function profileFor(dir){return read(path.join(dir,"client-owner.json"),null)?.profile||path.dirname(path.resolve(dir));}
function ownerAlive(profile,state){
  if(!state||!Number.isInteger(state.pid)||state.pid<1)return false;
  try{const args=fs.readFileSync('/proc/'+state.pid+'/cmdline','utf8').split('\0');return args.includes(path.join(__dirname,'cloud.cjs'))&&args.includes(path.resolve(profile))&&base.alive(state.pid);}catch{return false;}
}
function clientActive(dir){
  try{const profile=require("./release.cjs").requireProfile(profileFor(dir)),state=read(path.join(profile,"cloud-runtime.json"),null);return !!(state?.desiredRunning&&ownerAlive(profile,state));}catch{return false;}
}
async function requireClient(dir){if(!clientActive(dir))throw Error("请先启动纯云端实例：Start-Cloud.sh；仅限云端下载使用");}
module.exports={...base,cloudEdition:true,profileFor,clientActive,requireClient,ownerAlive,launch:async()=>{throw Error("纯云端版不启动图形客户端，请使用 Start-Cloud.sh");}};
