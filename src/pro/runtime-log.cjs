"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {threadId}=require('node:worker_threads');
const zlib=require('node:zlib');
const sinks=new Map();
const LIMIT=256*1024,COPIES=2,MAX_ENTRY=12*1024,MAX_TOTAL=16*1024*1024;
const secretKeys=/^(?:authorization|cookie|token|password|passphrase|secret|privateKey|clientPrivateKey|command|payload|body|stdout|stderr|env|codeFile)$/i;
function cleanText(input,max=Infinity){return String(input).replace(/Command failed:[^\n]*/g,'Command failed [invocation redacted]').replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*PRIVATE KEY-----|$)/g,'[PRIVATE KEY REDACTED]').replace(/\b(?:57-)?[A-Z2-9]{10}-[A-Z2-9]{10}\b/g,'[PAIR CODE REDACTED]').replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/((?:token|password|passphrase|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/gi,'$1[REDACTED]').replace(/\b[a-f0-9]{64}\b/gi,'[CREDENTIAL REDACTED]').slice(0,max);}
function safe(value,depth=0,seen=new Set()){
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return cleanText(value);
 if(typeof value!=='object')return cleanText(value);
 if(seen.has(value))return '[Circular reference]';seen.add(value);
 if(value instanceof Error){const out={name:cleanText(value.name),message:cleanText(value.message),stack:cleanText(value.stack||'')};for(const key of Object.getOwnPropertyNames(value))if(!['name','message','stack'].includes(key))out[key]=secretKeys.test(key)?'[REDACTED]':safe(value[key],depth+1,seen);seen.delete(value);return out;}
 if(Array.isArray(value)){const out=value.map(v=>safe(v,depth+1,seen));seen.delete(value);return out;}
 const out={};for(const [key,v]of Object.entries(value))out[key]=secretKeys.test(key)?'[REDACTED]':safe(v,depth+1,seen);seen.delete(value);return out;
}
function location(){const a=process.argv;let profile=process.env.SSH_RELAY_CLIENT_PROFILE;for(const flag of ['--profile-dir','--state-dir']){const i=a.lastIndexOf(flag);if(i>=0&&a[i+1]){const dir=path.resolve(a[i+1]);profile=flag==='--profile-dir'?dir:path.dirname(dir);break;}}if(profile&&fs.existsSync(path.join(profile,'application-release.json')))return path.join(profile,'logs');return path.join(os.tmpdir(),'ssh-relay-5.7-diagnostics');}
function guard(file){if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Log symlink refused');}
function rotate(file,bytes,limit=LIMIT){guard(file);if(fs.existsSync(file)&&fs.statSync(file).size+bytes>limit)fs.renameSync(file,file+'.'+Date.now()+'-'+process.pid+'.jsonl');}
function fallback(error,event,original){try{process.emit('relay-diagnostic-fault',error);}catch{}const entry=JSON.stringify({time:new Date().toISOString(),pid:process.pid,event:'diagnostic_write_failed',originalEvent:cleanText(event,100),error:safe(error),original:safe(original)})+'\n';
 try{fs.writeSync(2,entry);}catch{}
 try{const dir=path.join(os.tmpdir(),'ssh-relay-5.7-diagnostics');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'emergency-'+process.pid+'.jsonl');if(fs.existsSync(file)&&fs.statSync(file).size+Buffer.byteLength(entry)>LIMIT)fs.renameSync(file,file+'.'+Date.now()+'.jsonl');fs.appendFileSync(file,entry,{mode:0o600});}catch(backupError){try{fs.writeSync(2,JSON.stringify({event:'all_diagnostic_sinks_failed',error:safe(backupError)})+'\n');}catch{}}
}
function createLogger({directory=location(),name='process',file,limit=LIMIT,copies=COPIES}={}){
 file=file||path.join(directory,'runtime-'+name.replace(/[^a-z0-9_-]/gi,'_')+'-'+process.pid+'-'+threadId+'.jsonl');directory=path.dirname(file);
 if(sinks.has(file))return sinks.get(file);
 let fd=null,size=0,sequence=0,lastTrim=0;
 function open(){if(fd!==null)return;fs.mkdirSync(directory,{recursive:true,mode:0o700});guard(directory);guard(file);fd=fs.openSync(file,'a',0o600);size=fs.fstatSync(fd).size;}
 function write(line){const bytes=Buffer.from(line);let offset=0;while(offset<bytes.length)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);size+=bytes.length;}
 function seal(){if(fd===null)return;fs.fsyncSync(fd);fs.closeSync(fd);fd=null;}
 function record(event,details={}){
  try{
   const entry={...safe(details),time:new Date().toISOString(),pid:process.pid,ppid:process.ppid,threadId,role:name,event:cleanText(event),sequence:++sequence};
   const line=JSON.stringify(entry)+'\n';open();
   if(size&&size+Buffer.byteLength(line)>limit){
    seal();const archive=file+'.'+Date.now()+'-'+sequence+'.gz';guard(archive);
    const compressed=zlib.gzipSync(fs.readFileSync(file));const archiveFd=fs.openSync(archive,'wx',0o600);
    try{fs.writeFileSync(archiveFd,compressed);fs.fsyncSync(archiveFd);}finally{fs.closeSync(archiveFd);}
    fs.truncateSync(file,0);open();write(JSON.stringify({time:new Date().toISOString(),event:'log_archived',archive:path.basename(archive),pid:process.pid,role:name})+'\n');
   }
   // Large errors remain complete. A record is never cut to satisfy a file limit.
   write(line);
   if(details.fatal)fs.fsyncSync(fd);
   if(Date.now()-lastTrim>30000){lastTrim=Date.now();maintainArchives(directory);}
   return true;
  }catch(error){try{seal();}catch{}fallback(error,event,details);return false;}
 }
 const logger={record,file,directory,flush:()=>{try{if(fd!==null)fs.fsyncSync(fd);}catch(error){fallback(error,'log_flush_failed');}}};
 sinks.set(file,logger);return logger;
}
function maintainArchives(directory){
 const files=fs.readdirSync(directory).filter(n=>/\.jsonl\.\d+-\d+\.gz$/.test(n)).map(name=>{const file=path.join(directory,name);guard(file);return {file,name,...fs.statSync(file)};});
 const bytes=files.reduce((n,f)=>n+f.size,0);
 // Space limits are warnings, never a reason to silently discard errors.
 if(bytes>MAX_TOTAL){try{process.emit('relay-diagnostic-retention',{bytes,budget:MAX_TOTAL});}catch{}const notice=path.join(directory,'RETENTION-NOTICE.json');guard(notice);fs.writeFileSync(notice,JSON.stringify({time:new Date().toISOString(),event:'log_archive_budget_exceeded',bytes,budget:MAX_TOTAL,action:'Preserve archives; export or explicitly clear history'}),{mode:0o600});}
}
function capLegacy(profile,logger){for(const name of ['client-process.log','client-supervisor.log','near/bootstrap.log','far/bootstrap.log']){const file=path.join(profile,name);try{guard(file);if(!fs.existsSync(file)||fs.statSync(file).size<=LIMIT)continue;const archive=file+'.'+Date.now()+'.gz';fs.writeFileSync(archive,zlib.gzipSync(fs.readFileSync(file)),{flag:'wx',mode:0o600});const fd=fs.openSync(file,'r+');try{const stat=fs.fstatSync(fd),tail=Buffer.alloc(LIMIT/2);const n=fs.readSync(fd,tail,0,tail.length,Math.max(0,stat.size-tail.length));fs.writeSync(fd,tail,0,n,0);fs.ftruncateSync(fd,n);}finally{fs.closeSync(fd);}logger.record('legacy_log_compacted',{file:name});}catch(error){logger.record('legacy_log_compaction_failed',{file:name,error});}}}
let installed;
function install(name){if(installed)return installed;const logger=createLogger({name});installed=logger;logger.record('process_start',{version:'5.7-branch',node:process.versions.node,electron:process.versions.electron,platform:process.platform});
 process.on('uncaughtExceptionMonitor',(error,origin)=>logger.record('uncaught_exception',{error,origin,fatal:true}));
 process.on('uncaughtException',(error,origin)=>{if(name!=='gui')process.exitCode=1;process.emit('relay-unexpected-error',error,origin);});
 process.on('unhandledRejection',reason=>{logger.record('unhandled_rejection',{error:reason instanceof Error?reason:new Error(cleanText(reason)),fatal:false,disposition:'operation_failed'});process.emit('relay-unexpected-error',reason instanceof Error?reason:new Error(cleanText(reason)));});
 let tick=Date.now();const monitor=setInterval(()=>{const now=Date.now();if(now-tick>5000)logger.record('event_loop_stall',{delayMs:now-tick-1000});tick=now;},1000);monitor.unref();
 const profile=process.env.SSH_RELAY_CLIENT_PROFILE||(process.argv.includes('--profile-dir')?process.argv[process.argv.lastIndexOf('--profile-dir')+1]:null);if(profile){capLegacy(profile,logger);const maintenance=setInterval(()=>capLegacy(profile,logger),30000);maintenance.unref();}
 process.on('warning',warning=>logger.record('process_warning',{error:warning}));
 process.on('exit',code=>{logger.record('process_exit',{exitCode:code});for(const sink of sinks.values())sink.flush();});
 for(const [stream,name]of [[process.stdout,'stdout'],[process.stderr,'stderr']])stream.on('error',error=>{logger.record('output_pipe_error',{stream:name,error});});
 return logger;
}
const caughtLogs=new Map();
function captureCaught(error,context={}){try{let logger=installed;if(!logger){const key=location();logger=caughtLogs.get(key);if(!logger){logger=createLogger({directory:key,name:'caught'});caughtLogs.set(key,logger);}}logger.record('caught_error',{...context,error});}catch(failure){fallback(failure,'capture_caught_failed');}}
function observeChild(child,logger,label){child.once('spawn',()=>logger.record('child_spawn',{label,childPid:child.pid}));child.on('error',error=>logger.record('child_spawn_error',{label,childPid:child.pid,error}));child.once('exit',(code,signal)=>logger.record('child_exit',{label,childPid:child.pid,exitCode:code,signal}));for(const [stream,name]of [[child.stdout,'stdout'],[child.stderr,'stderr']])if(stream){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();let i;while((i=pending.indexOf('\n'))>=0){logger.record('child_console',{label,stream:name,message:cleanText(pending.slice(0,i))});pending=pending.slice(i+1);}if(pending.length>8192){logger.record('child_console',{label,stream:name,message:pending,fragment:true});pending='';}});stream.on('end',()=>{if(pending)logger.record('child_console',{label,stream:name,message:pending});});stream.on('error',error=>logger.record('child_pipe_error',{label,stream:name,error}));}}
module.exports={createLogger,install,safe,cleanText,rotate,observeChild,LIMIT,COPIES,MAX_TOTAL,captureCaught};
