"use strict";
const path=require('node:path'),{read}=require('../src/pro/store.cjs'),{systemVersion}=require('../src/pro/os-version.cjs');
function localStatus(profile,role){
 if(!['near','far'].includes(role))throw Error('Invalid role');
 const dir=path.join(profile,role),settings=read(path.join(dir,'settings.json'),{enabled:false,autoConnect:true,defaultDevice:null});
 const registry=read(path.join(dir,role==='near'?'devices.json':'far/authorized-clients.json'),{});
 const devices=Object.entries(registry).map(([id,d])=>({id,label:d.label,hostname:d.hostname,system:d.system,pairedAt:d.pairedAt,enabled:d.enabled!==false,state:'disconnected',connected:false}));
 const invitation=role==='far'?read(path.join(dir,'pair-invitations-private.json'),[]).filter(v=>v.expiresAt>Date.now()).at(-1):null;
 return {role,settings,system:systemVersion(),devices,state:settings.enabled?'starting':'disabled',initializing:settings.enabled===true,connectionLimit:20,invitation:invitation?{code:invitation.code,expiresAt:invitation.expiresAt}:null,admission:null};
}
module.exports={localStatus};
