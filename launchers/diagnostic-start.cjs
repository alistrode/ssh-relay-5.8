"use strict";
const path=require('node:path'),os=require('node:os');
const log=require('../src/pro/runtime-log.cjs').install('launcher');
const args=process.argv.slice(2),at=args.indexOf('--profile-dir'),profile=path.resolve(at<0?path.join(os.homedir(),'.ssh-relay-pro-5.5'):args[at+1]);
const appRoot=path.resolve(__dirname,'..');
const forwarded=args.filter(a=>a==='--disable-gpu'||a==='--no-shortcuts'||/^--remote-debugging-port=\d+$/.test(a));
require('../src/pro/client-lifecycle.cjs').launch({executable:process.execPath,appRoot,profile,development:false,args:forwarded})
 .then(state=>log.record('launcher_ready',{supervisorPid:state.pid}))
 .catch(error=>{log.record('launcher_failed',{error});process.exitCode=1;});
