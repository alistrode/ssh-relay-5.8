"use strict";
const fs=require('node:fs');
const cache=new Map();
function tailEvents(file){
  let stat;try{stat=fs.statSync(file);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const previous=cache.get(file);if(previous&&previous.size===stat.size&&previous.mtime===stat.mtimeMs)return previous.events;
  const length=Math.min(stat.size,64*1024),start=stat.size-length,buffer=Buffer.alloc(length);const fd=fs.openSync(file,'r');
  try{fs.readSync(fd,buffer,0,length,start);}finally{fs.closeSync(fd);}
  let text=buffer.toString('utf8');if(start)text=text.slice(text.indexOf('\n')+1);
  const events=[];for(const line of text.split('\n')){if(!line)continue;try{events.push(JSON.parse(line));}catch(error){require('./runtime-log.cjs').captureCaught(error,{component:'log-tail',file});}}
  const value={size:stat.size,mtime:stat.mtimeMs,events:events.slice(-300)};cache.set(file,value);return value.events;
}
module.exports={tailEvents};
