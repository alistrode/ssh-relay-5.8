"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {threadId}=require('node:worker_threads');
const LIMIT=256*1024,COPIES=2,MAX_ENTRY=12*1024,MAX_TOTAL=16*1024*1024;
const secretKeys=/^(?:authorization|cookie|token|password|passphrase|secret|privateKey|clientPrivateKey|command|payload|body|stdout|stderr|env|codeFile)$/i;
function cleanText(input,max=4096){return String(input).replace(/Command failed:[^\n]*/g,'Command failed [invocation redacted]').replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\n]*PRIVATE KEY-----|$)/g,'[PRIVATE KEY REDACTED]').replace(/\b(?:55-)?[A-Z2-9]{10}-[A-Z2-9]{10}\b/g,'[PAIR CODE REDACTED]').replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/((?:token|password|passphrase|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/gi,'$1[REDACTED]').replace(/\b[a-f0-9]{64}\b/gi,'[CREDENTIAL REDACTED]').slice(0,max);}
function safe(value,depth=0,seen=new Set()){
 if(value instanceof Error){if(seen.has(value))return '[Circular error]';seen.add(value);return {name:cleanText(value.name,80),message:cleanText(value.message,3072),code:cleanText(value.code||'',80),stack:cleanText(value.stack||'',6144),...(value.cause&&depth<4?{cause:safe(value.cause,depth+1,seen)}:{})};}
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return cleanText(value);
 if(typeof value!=='object')return cleanText(value,80);
 if(seen.has(value))return '[Circular]';if(depth>5)return '[Depth limited]';seen.add(value);
 if(Array.isArray(value))return value.slice(0,16).map(v=>safe(v,depth+1,seen));
 const out={};for(const [key,v]of Object.entries(value).slice(0,40))out[key]=secretKeys.test(key)?'[REDACTED]':safe(v,depth+1,seen);return out;
}
function location(){const a=process.argv;let profile=process.env.SSH_RELAY_CLIENT_PROFILE;for(const flag of ['--profile-dir','--state-dir']){const i=a.lastIndexOf(flag);if(i>=0&&a[i+1]){const dir=path.resolve(a[i+1]);profile=flag==='--profile-dir'?dir:path.dirname(dir);break;}}if(profile&&fs.existsSync(path.join(profile,'application-release.json')))return path.join(profile,'logs');return path.join(os.tmpdir(),'ssh-relay-5.6-diagnostics');}
function guard(file){if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Log symlink refused');}
function rotate(file,bytes,limit=LIMIT,copies=COPIES){guard(file);if(!fs.existsSync(file)||fs.statSync(file).size+bytes<=limit)return;for(let i=copies;i>=1;i--){const dst=file+'.'+i,src=i===1?file:file+'.'+(i-1);guard(dst);guard(src);if(fs.existsSync(dst))fs.unlinkSync(dst);if(fs.existsSync(src))fs.renameSync(src,dst);}}
function fallback(error,event,original){const entry=JSON.stringify({time:new Date().toISOString(),pid:process.pid,event:'diagnostic_write_failed',originalEvent:cleanText(event,100),error:safe(error),original:safe(original)})+'\n';
 try{fs.writeSync(2,entry);}catch{}
 try{const dir=path.join(os.tmpdir(),'ssh-relay-5.6-diagnostics');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'emergency-'+process.pid+'.jsonl');rotate(file,Buffer.byteLength(entry));fs.appendFileSync(file,entry,{mode:0o600});trim(dir);}catch{}
}
function trim(directory){const files=fs.readdirSync(directory).filter(n=>/\.jsonl(?:\.\d+)?$/.test(n)).map(n=>{const file=path.join(directory,n);guard(file);return {file,...fs.statSync(file)};}).sort((a,b)=>a.mtimeMs-b.mtimeMs);let total=files.reduce((n,f)=>n+f.size,0);while(files.length>64||total>MAX_TOTAL){const f=files.shift();fs.unlinkSync(f.file);total-=f.size;}}
function createLogger({directory=location(),name='process',file,limit=LIMIT,copies=COPIES}={}){
 file=file||path.join(directory,'runtime-'+name.replace(/[^a-z0-9_-]/gi,'_')+'-'+process.pid+'-'+threadId+'.jsonl');directory=path.dirname(file);let lastTrim=0;
 function record(event,details={}){try{fs.mkdirSync(directory,{recursive:true,mode:0o700});guard(directory);let entry={time:new Date().toISOString(),pid:process.pid,ppid:process.ppid,role:name,event:cleanText(event,100),...safe(details)};let line=JSON.stringify(entry);if(Buffer.byteLength(line)>MAX_ENTRY)line=JSON.stringify({time:entry.time,pid:process.pid,role:name,event:entry.event,truncated:true,details:cleanText(line,Math.floor(MAX_ENTRY/3))});while(Buffer.byteLength(line)>MAX_ENTRY){entry={time:entry.time,pid:process.pid,role:name,event:cleanText(event,100),truncated:true,details:line.slice(0,Math.floor(line.length/3))};line=JSON.stringify(entry);}line+='\n';rotate(file,Buffer.byteLength(line),limit,copies);fs.appendFileSync(file,line,{mode:0o600});if(Date.now()-lastTrim>30000){trim(directory);lastTrim=Date.now();}return true;}catch(error){fallback(error,event,details);return false;}}
 return {record,file,directory};
}
function capLegacy(profile,logger){for(const name of ['client-process.log','client-supervisor.log','near/bootstrap.log','far/bootstrap.log']){const file=path.join(profile,name);try{guard(file);if(!fs.existsSync(file)||fs.statSync(file).size<=LIMIT)continue;const fd=fs.openSync(file,'r+');try{const stat=fs.fstatSync(fd),tail=Buffer.alloc(LIMIT/2);const n=fs.readSync(fd,tail,0,tail.length,Math.max(0,stat.size-tail.length));fs.writeSync(fd,tail,0,n,0);fs.ftruncateSync(fd,n);}finally{fs.closeSync(fd);}logger.record('legacy_log_compacted',{file:name});}catch(error){logger.record('legacy_log_compaction_failed',{file:name,error});}}}
let installed;
function install(name){if(installed)return installed;const logger=createLogger({name});installed=logger;logger.record('process_start',{version:'5.6-branch',node:process.versions.node,electron:process.versions.electron,platform:process.platform});
 process.on('uncaughtExceptionMonitor',(error,origin)=>logger.record('uncaught_exception',{error,origin,fatal:true}));
 process.on('uncaughtException',()=>process.exit(1));
 process.on('unhandledRejection',reason=>{logger.record('unhandled_rejection',{error:reason instanceof Error?reason:new Error(cleanText(reason)),fatal:true});process.exit(1);});
 let tick=Date.now();const monitor=setInterval(()=>{const now=Date.now();if(now-tick>5000)logger.record('event_loop_stall',{delayMs:now-tick-1000});tick=now;},1000);monitor.unref();
 const profile=process.env.SSH_RELAY_CLIENT_PROFILE||(process.argv.includes('--profile-dir')?process.argv[process.argv.lastIndexOf('--profile-dir')+1]:null);if(profile){capLegacy(profile,logger);const maintenance=setInterval(()=>capLegacy(profile,logger),30000);maintenance.unref();}
 process.on('warning',warning=>logger.record('process_warning',{error:warning}));
 process.on('exit',code=>logger.record('process_exit',{exitCode:code}));
 for(const [stream,name]of [[process.stdout,'stdout'],[process.stderr,'stderr']])stream.on('error',error=>{logger.record('output_pipe_error',{stream:name,error});if(!['EPIPE','ERR_STREAM_DESTROYED'].includes(error.code))process.exit(1);});
 return logger;
}
const caughtLogs=new Map();
function captureCaught(error,context={}){try{if(['ENOENT','ESRCH','ENOTDIR'].includes(error?.code))return;let logger=installed;if(!logger){const key=location();logger=caughtLogs.get(key);if(!logger){logger=createLogger({directory:key,name:'caught'});caughtLogs.set(key,logger);}}logger.record('caught_error',{...context,error});}catch(failure){fallback(failure,'capture_caught_failed');}}
function observeChild(child,logger,label){child.once('spawn',()=>logger.record('child_spawn',{label,childPid:child.pid}));child.on('error',error=>logger.record('child_spawn_error',{label,childPid:child.pid,error}));child.once('exit',(code,signal)=>logger.record('child_exit',{label,childPid:child.pid,exitCode:code,signal}));for(const [stream,name]of [[child.stdout,'stdout'],[child.stderr,'stderr']])if(stream){let pending='';stream.on('data',chunk=>{pending+=chunk.toString();let i;while((i=pending.indexOf('\n'))>=0){logger.record('child_console',{label,stream:name,message:cleanText(pending.slice(0,i),6144)});pending=pending.slice(i+1);}if(pending.length>8192){logger.record('child_console',{label,stream:name,message:pending.slice(0,6144),truncated:true});pending='';}});stream.on('end',()=>{if(pending)logger.record('child_console',{label,stream:name,message:pending});});stream.on('error',error=>logger.record('child_pipe_error',{label,stream:name,error}));}}
module.exports={createLogger,install,safe,cleanText,rotate,observeChild,LIMIT,COPIES,MAX_TOTAL,captureCaught};
