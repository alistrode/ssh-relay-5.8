"use strict";
// External native GUI acceptance: no fixed 12-second startup deadline on TCG.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const exe=path.resolve(process.argv[2]),profile=path.resolve(process.argv[3]);
if(fs.existsSync(profile))throw Error('A fresh isolated GUI profile is required');fs.mkdirSync(profile,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const log=fs.openSync(path.join(profile,'native-output.log'),'a');
const child=cp.spawn(exe,['--profile-dir',profile,'--observe-only','--no-shortcuts'],{env,stdio:['ignore',log,log]});fs.closeSync(log);let exited=false;child.once('close',()=>exited=true);
(async()=>{try{
 let status;const end=Date.now()+120000;
 while(Date.now()<end&&!exited){try{status=JSON.parse(fs.readFileSync(path.join(profile,'gui-status.json')));if(fs.statSync(path.join(profile,'observer.png')).size>5000)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 assert(status&&!exited,'Native GUI did not produce a live rendered observation');assert(status.title.includes('SSH Relay Pro'));
 await new Promise(r=>setTimeout(r,10000));assert(!exited,'GUI exited after first render');
 const events=fs.readFileSync(path.join(profile,'logs/gui.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.event==='window_loaded'));assert(!events.some(e=>e.event==='render_process_gone'&&e.reason==='crashed'));
 fs.writeFileSync(path.join(profile,'acceptance.json'),JSON.stringify({passed:true,title:status.title,windowLoaded:true,liveAfterRender:true,screenshotBytes:fs.statSync(path.join(profile,'observer.png')).size,cleanup:'test terminates its own GUI after observation'}));
}catch(e){fs.writeFileSync(path.join(profile,'failure.txt'),e.stack);process.exitCode=1;}finally{
 if(!exited){if(process.platform==='win32')cp.spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}
}})();
