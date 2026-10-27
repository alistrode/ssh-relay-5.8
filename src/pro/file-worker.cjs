"use strict";
const runtimeLog=require('./runtime-log.cjs').install('file-worker');
const {parentPort,workerData}=require('node:worker_threads'),{read}=require('./store.cjs'),{RemoteFiles}=require('./remote-files.cjs');
if(!parentPort||!workerData)throw Error('File service worker requires trusted startup data');
parentPort.on('message',request=>{
 const {key,owner,method,params}=request;
 try{
  const {dir,deviceId,authorizedFile}=workerData;
  const files=new RemoteFiles({dir,deviceId,authorized:id=>id===owner&&!!read(authorizedFile,{})[id]});
  const value=files.handle(owner,method,params);parentPort.postMessage({key,ok:true,value});
 }catch(error){
  runtimeLog.record('file_request_failed',{key,owner,method,transferId:params?.transferId,error});
  const known=/^(TRANSFER_|SOURCE_CHANGED$|DESTINATION_CHANGED$|REQUEST_CONFLICT$|AUTH_REVOKED$|CONTROL_)/.test(error.code||'');
  parentPort.postMessage({key,ok:false,code:known?error.code:'TRANSFER_STORAGE_FAILED',message:known?error.message:'File service storage operation failed'});
 }
});
