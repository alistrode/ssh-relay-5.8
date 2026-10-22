'use strict';
// Prepare only the pinned Windows service host; no elevation or system changes.
if(process.platform!=='win32')process.exit(0);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),pin=require('../assets/pro-runtime-inputs.json').winsw;
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const folder=path.join(root,'vendor'),target=path.join(folder,'WinSW-x64.exe');
fs.mkdirSync(folder,{recursive:true});
if(fs.existsSync(target)&&hash(target)===pin.sha256)process.exit(0);
const cached=path.join(root,'work/runtime',pin.file);
if(fs.existsSync(cached)&&hash(cached)===pin.sha256)fs.copyFileSync(cached,target);
else{
 const temporary=target+'.partial';
 const fetch=url=>cp.spawnSync('curl.exe',['--fail','--location','--speed-limit','819200','--speed-time','15','--connect-timeout','20','--max-time','90','--output',temporary,url],{stdio:'inherit'}).status===0;
 let ok=fetch(pin.url);
 if(!ok){
  const metadata=JSON.parse(cp.execFileSync('curl.exe',['--fail','--silent','--show-error','--location','https://api.github.com/repos/winsw/winsw/releases/tags/v'+pin.version],{encoding:'utf8'}));
  const asset=metadata.assets.find(a=>a.name===pin.file);if(!asset)throw Error('Pinned WinSW asset unavailable');
  ok=cp.spawnSync('curl.exe',['--fail','--location','--header','Accept: application/octet-stream','--speed-limit','819200','--speed-time','15','--max-time','90','--output',temporary,asset.url],{stdio:'inherit'}).status===0;
 }
 if(!ok||hash(temporary)!==pin.sha256){fs.rmSync(temporary,{force:true});throw Error('Pinned service host download or checksum failed')}
 fs.renameSync(temporary,target);
}
const license=path.join(folder,'LICENSE.WinSW'),cachedLicense=path.join(root,'work/runtime/WinSW-LICENSE');
if(fs.existsSync(cachedLicense))fs.copyFileSync(cachedLicense,license);
else if(cp.spawnSync('curl.exe',['--fail','--location','--max-time','30','--output',license,'https://raw.githubusercontent.com/winsw/winsw/v'+pin.version+'/LICENSE.txt'],{stdio:'inherit'}).status!==0)throw Error('Service host license download failed');
console.log('Pinned Windows service host ready; installation stays behind the UI authorization button.');
