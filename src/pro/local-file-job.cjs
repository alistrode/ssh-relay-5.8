"use strict";
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){
 const log=require('./runtime-log.cjs').install('local-file-job');
 try{
  const {TransferSnapshots}=require('./file-transfer.cjs');
  if(!['create','validate'].includes(workerData.method))throw Error('Unsupported local file job');
  const result=new TransferSnapshots(workerData.directory)[workerData.method](workerData.input);
  parentPort.postMessage({ok:true,result});
 }catch(error){log.record('local_file_job_failed',{method:workerData.method,error});parentPort.postMessage({ok:false,error:{message:error.message,code:error.code,stack:error.stack}});}
 parentPort.close();
}else{
 const {captureCaught}=require('./runtime-log.cjs');let active=0;const queue=[];
 function drain(){
  while(active<2&&queue.length){
   const job=queue.shift();active++;let done=false;
   const finish=(error,result)=>{if(done)return;done=true;active--;if(error){captureCaught(error,{component:'local-file-job',method:job.method});job.reject(error);}else job.resolve(result);drain();};
   try{
    const worker=new Worker(__filename,{workerData:{directory:job.directory,method:job.method,input:job.input}});
    worker.once('message',receipt=>{if(receipt?.ok===true)finish(null,receipt.result);else finish(Object.assign(Error(receipt?.error?.message||'Local file job failed'),{code:receipt?.error?.code||'TRANSFER_STORAGE_FAILED',stack:receipt?.error?.stack}));});
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!done)finish(Object.assign(Error('Local file job exited before a receipt (exit '+code+')'),{code:'TRANSFER_OUTCOME_UNKNOWN'}));});
   }catch(error){finish(error);}
  }
 }
 function run(directory,method,input){
  if(!['create','validate'].includes(method))return Promise.reject(Error('Unsupported local file job'));
  if(queue.length>=64)return Promise.reject(Object.assign(Error('Local file job queue is full'),{code:'TRANSFER_CAPACITY'}));
  return new Promise((resolve,reject)=>{queue.push({directory,method,input,resolve,reject});drain();});
 }
 module.exports={run};
}
