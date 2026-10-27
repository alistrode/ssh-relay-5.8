"use strict";
const path=require('node:path'),{Worker}=require('node:worker_threads'),{randomUUID}=require('node:crypto');
const {operationId}=require('./task-spec.cjs'),{captureCaught,createLogger}=require('./runtime-log.cjs');
const log=createLogger({name:'file-service'});
function failure(code,message){return Object.assign(Error(message),{code});}
class FileService{
 constructor({dir,deviceId,authorized,authorizedFile}){
  this.dir=path.resolve(dir);this.deviceId=operationId(deviceId);this.authorized=authorized;this.authorizedFile=path.resolve(authorizedFile);
  this.queue=[];this.busy=new Set();this.slots=new Set();this.closed=false;this.fault=null;
 }
 handle(owner,method,params){
  operationId(owner);const id=operationId(params.transferId);
  if(this.closed||this.fault)return Promise.reject(this.fault||failure('TRANSFER_SERVICE_CLOSED','File service is closing'));
  if(!this.authorized(owner))return Promise.reject(failure('AUTH_REVOKED','Transfer authorization is unavailable'));
  if(this.busy.has(id))return Promise.reject(failure('TRANSFER_BUSY','A request for this transfer is still in progress; query the same ID'));
  if(this.queue.length>=64)return Promise.reject(failure('TRANSFER_CAPACITY','File service request queue is full'));
  this.busy.add(id);
  return new Promise((resolve,reject)=>{this.queue.push({owner,method,params,id,resolve,reject,key:randomUUID()});this.drain();});
 }
 fail(error){
  captureCaught(error,{component:'file-service',disposition:'fail-outstanding-requests'});this.fault=error;
  for(const request of this.queue.splice(0)){this.busy.delete(request.id);request.reject(error);}
  for(const slot of this.slots){if(slot.request){this.busy.delete(slot.request.id);slot.request.reject(error);slot.request=null;}void slot.worker.terminate().catch(e=>captureCaught(e,{component:'file-service-terminate'}));}
  this.slots.clear();
 }
 createSlot(){
  const worker=new Worker(path.join(__dirname,'file-worker.cjs'),{workerData:{dir:this.dir,deviceId:this.deviceId,authorizedFile:this.authorizedFile}});
  log.record("file_worker_created",{threadId:worker.threadId});
  const slot={worker,request:null};this.slots.add(slot);worker.unref();
  worker.on('message',message=>{
   const request=slot.request;
   if(!request||message?.key!==request.key||typeof message.ok!=='boolean'){this.fail(failure('TRANSFER_WORKER_FAILED','File service returned an invalid receipt'));return;}
   slot.request=null;this.busy.delete(request.id);worker.unref();
   if(message.ok)request.resolve(message.value);else request.reject(failure(message.code||'TRANSFER_STORAGE_FAILED',message.message||'File request failed'));
   this.drain();
  });
  worker.on('error',error=>{if(!this.closed&&!this.fault)this.fail(Object.assign(Error('File service worker failed; query the original transfer ID'),{code:'TRANSFER_WORKER_FAILED',cause:error}));});
  worker.on('exit',code=>{log.record('file_worker_exit',{threadId:worker.threadId,exitCode:code,serviceClosing:this.closed});this.slots.delete(slot);if(!this.closed&&!this.fault)this.fail(failure('TRANSFER_OUTCOME_UNKNOWN','File service worker exited without a receipt; query the original transfer ID (exit '+code+')'));});
  return slot;
 }
 drain(){
  if(this.closed||this.fault)return;
  while(this.queue.length){
   let slot=[...this.slots].find(s=>!s.request);
   if(!slot&&this.slots.size>=2)return;
   try{if(!slot)slot=this.createSlot();}catch(error){this.fail(error);return;}
   const request=this.queue.shift();
   if(!this.authorized(request.owner)){this.busy.delete(request.id);request.reject(failure('AUTH_REVOKED','Transfer authorization was revoked'));continue;}
   slot.request=request;slot.worker.ref();
   try{slot.worker.postMessage({key:request.key,owner:request.owner,method:request.method,params:request.params});}catch(error){this.fail(error);return;}
  }
 }
 async close(){
  this.closed=true;const error=failure('TRANSFER_SERVICE_CLOSED','File service stopped; query unfinished transfers by original ID');
  for(const request of this.queue.splice(0)){this.busy.delete(request.id);request.reject(error);}
  await Promise.all([...this.slots].map(async slot=>{if(slot.request){slot.request.reject(error);this.busy.delete(slot.request.id);slot.request=null;}await slot.worker.terminate();}));this.slots.clear();
 }
}
module.exports={FileService};
