"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const readline=require('node:readline'),{Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {createLogger,safe,captureCaught}=require('./runtime-log.cjs');
function create(directory,{limit=256*1024,copies=2,runId=crypto.randomUUID()}={}){
 const sink=createLogger({file:path.join(directory,'gui.jsonl'),name:'gui',limit,copies});let available=true;
 return {record:(event,details={})=>{available=sink.record(event,{runId,...details});},runId,get available(){return available;}};
}
function logFiles(directory){
 const result=[],profile=path.dirname(directory);
 for(const dir of [directory,profile,path.join(profile,'near'),path.join(profile,'far'),path.join(profile,'near','logs'),path.join(profile,'far','logs')]){
  if(!fs.existsSync(dir))continue;
  if(fs.lstatSync(dir).isSymbolicLink())throw Error('Diagnostic directory symlink refused');
  for(const name of fs.readdirSync(dir)){
   if(!/^(?:runtime-.+|agent-events|guardian-events|gui|launcher|emergency-.+|chromium|client-process|client-supervisor|bootstrap)\.(?:jsonl|log)(?:\.[\w.-]+)?$/.test(name)&&name!=='RETENTION-NOTICE.json')continue;
   const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Diagnostic symlink refused');
   if(stat.isFile())result.push({file,name:path.relative(profile,file)});
  }
 }
 return result.sort((a,b)=>a.name.localeCompare(b.name));
}
async function exportDiagnostics(directory,destination){
 const files=logFiles(directory);let count=0;
 async function* records(){
  yield '{"schema":3,"records":[';let first=true;
  for(const item of files){
   const input=fs.createReadStream(item.file,{flags:fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)});
   const source=item.file.endsWith('.gz')?input.pipe(zlib.createGunzip()):input;
   if(source!==input)input.on('error',error=>source.destroy(error));
   const lines=readline.createInterface({input:source,crlfDelay:Infinity});
   try{
    for await(const line of lines){
     if(!line)continue;let value;
     try{value=JSON.parse(line);}catch{value={event:'unstructured_log',message:line};}
     yield (first?'':',')+JSON.stringify({source:item.name,...safe(value)});first=false;count++;
    }
   }catch(error){captureCaught(error,{component:'diagnostic-export',file:item.name});yield (first?'':',')+JSON.stringify({source:item.name,event:'export_read_failed',error:safe(error)});first=false;}
   finally{lines.close();source.destroy();input.destroy();}
  }
  yield ']}';
 }
 await pipeline(Readable.from(records()),zlib.createGzip(),fs.createWriteStream(destination,{flags:'wx',mode:0o600}));return count;
}
function installPipeGuards(record){for(const stream of [process.stdout,process.stderr])stream.on('error',error=>record('output_pipe_error',{error}));}
module.exports={create,exportDiagnostics,installPipeGuards};
if(require.main===module){
 (async()=>{if(process.argv.length!==4)throw Error('Expected log directory and new export file');await exportDiagnostics(process.argv[2],process.argv[3]);})().catch(error=>{captureCaught(error,{component:'diagnostic-export'});process.exitCode=1;});
}
