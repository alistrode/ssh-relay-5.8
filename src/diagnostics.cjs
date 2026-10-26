"use strict";
const path=require("node:path"),{createLogger}=require("./pro/runtime-log.cjs");
function createTraceWriter(directory,role){const logger=createLogger({file:path.join(directory,role+"-events.jsonl"),name:role});const seen=new Map();return entry=>{const key=entry.event+":"+(entry.trace?.event||"");const now=Date.now();if(entry.event==="worker_trace"&&!/error|fail|invalid|reject|timeout|close|offline/i.test(entry.trace?.event||"")){const prev=seen.get(key);if(prev&&now-prev.time<30000){prev.count++;return;}if(prev?.count)logger.record("trace_sample_summary",{traceEvent:key,suppressed:prev.count});if(seen.size>128)seen.clear();seen.set(key,{time:now,count:0});}logger.record(entry.event||"trace",entry);};}
module.exports={createTraceWriter};
