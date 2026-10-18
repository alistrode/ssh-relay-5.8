"use strict";
// Own near/far identities only. Never accepts an existing connection report.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const appRoot = process.env.RELAY_TEST_APP_ROOT || path.resolve(__dirname,"../..");
const { Client } = require(path.join(appRoot,"node_modules/ssh2")), { Agent } = require(path.join(appRoot,"src/pro/agent.cjs")), { request } = require(path.join(appRoot,"src/pro/cli.cjs"));
const root = process.argv[2] || path.join(os.tmpdir(), "relay-admission-" + crypto.randomUUID());
if (fs.existsSync(root)) throw Error("An isolated integration test requires a new directory");
fs.mkdirSync(root, { recursive:true, mode:0o700 });
const net = require("node:net");
const echoServer = net.createServer(socket => socket.pipe(socket));
const agents = {}, clients = [], results = [], sleep = ms => new Promise(r => setTimeout(r, ms));
function record(name) { results.push({ name, passed:true }); fs.writeFileSync(path.join(root,"results.json"), JSON.stringify(results,null,2)); console.log(JSON.stringify(results.at(-1))); }
async function until(label, fn, timeout = 120000) { const end=Date.now()+timeout; while(Date.now()<end) { const result=await fn(); if(result)return result; await sleep(250); } throw Error("Timed out: " + label); }
const api = (role,route,body) => request(path.join(root,role),route,body);
const command = text => process.platform === "win32" ? "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(text,"utf16le").toString("base64") : text;
async function connect(report) {
  const client = new Client(); clients.push(client);
  const key = report.ssh_argv[report.ssh_argv.indexOf("-i")+1];
  await new Promise((resolve,reject) => { client.on("error",reject); client.once("ready",resolve); client.connect({host:"127.0.0.1",port:report.local_port,username:"relay",privateKey:fs.readFileSync(key),readyTimeout:60000,hostVerifier:value=>"SHA256:"+crypto.createHash("sha256").update(value).digest("base64").replace(/=+$/,"")===report.host_fingerprint}); });
  return client;
}
async function execute(client, text) {
  const stream = await new Promise((resolve,reject)=>client.exec(command(text),(e,s)=>e?reject(e):resolve(s)));
  const state = { stdout:"", stderr:"" };
  stream.on("data",b=>state.stdout+=b); stream.stderr.on("data",b=>state.stderr+=b);
  state.result = new Promise((resolve,reject)=>{stream.on("error",reject);stream.on("close",code=>resolve({code,stdout:state.stdout,stderr:state.stderr}));});
  state.result.catch(()=>{});return state;
}
const call = (sftp, method, ...args) => new Promise((resolve,reject)=>sftp[method](...args,(error,value)=>error?reject(error):resolve(value)));
(async()=>{
 try {
  for(const role of ["far","a","b"]) { agents[role]=new Agent({role:role==="far"?"far":"near",dir:path.join(root,role),allowCloudSelfTest:true,brokerUrl:process.env.RELAY_LAB_BROKER||"wss://broker.emqx.io:8084/mqtt"}); await agents[role].start(); }
  const pair = async role => { const offer=await api("far","/pair/create",{});await api(role,"/pair/connect",{code:offer.code}); };
  await pair("a"); const a=await until("first verified controller",()=>{const d=agents.a.status().devices[0];return d?.state==="online"&&d;});
  const report=JSON.parse(fs.readFileSync(a.connectionReport));assert.equal(report.cloud_self_test,true);record("isolated_native_pair_and_pinned_identity");
  await new Promise(resolve => echoServer.listen(0,"127.0.0.1",resolve));
  const original=await connect(report), sftp=await new Promise((resolve,reject)=>original.sftp((e,s)=>e?reject(e):resolve(s)));
  const forward=await new Promise((resolve,reject)=>original.forwardOut("127.0.0.1",0,"127.0.0.1",echoServer.address().port,(e,c)=>e?reject(e):resolve(c)));
  const echo=async text=>{const result=new Promise((resolve,reject)=>{forward.once("data",b=>resolve(b.toString()));forward.once("error",reject);});forward.write(text);assert.equal(await result,text);};
  await echo("before-switch");
  const file=path.join(root,"draining-transfer.bin"), handle=await call(sftp,"open",file,"w");
  const long=await execute(original,process.platform==="win32"?'Write-Output start; Start-Sleep -Seconds 45; Write-Output complete':'printf start; sleep 45; printf complete');
  await until("original task started",()=>long.stdout.includes("start"));
  await pair("b");await until("busy preflight",()=>agents.b.status().devices[0]?.state==="remote_busy");
  let pending=await until("remote consent request",()=>agents.far.status().admission?.pending?.[0]);assert.equal(agents.a.status().devices[0].state,"online");assert(!long.stdout.includes("complete"));record("busy_probe_refused_without_interrupting_original");
  await api("far","/connection/decision",{requestId:pending.requestId,approve:false});await sleep(1000);assert.equal(agents.b.status().devices[0].state,"remote_busy");record("decline_preserves_original");
  await api("b","/retry",{});pending=await until("explicit retry request",()=>agents.far.status().admission?.pending?.[0]);await api("far","/connection/decision",{requestId:pending.requestId,approve:true});
  const b=await until("replacement identity verified",()=>{const d=agents.b.status().devices[0];return d?.state==="online"&&d;});const next=JSON.parse(fs.readFileSync(b.connectionReport));assert.equal(agents.far.status().admission.ownerId,agents.b.identity.deviceId);record("approved_candidate_verified_before_switch");
  await echo("after-switch");
  await assert.rejects(()=>new Promise((resolve,reject)=>original.forwardOut("127.0.0.1",0,"127.0.0.1",echoServer.address().port,(e,c)=>e?reject(e):resolve(c))));
  forward.end();record("existing_forward_continues_but_new_forward_is_refused");
  const data=Buffer.from("continued-transfer");await call(sftp,"write",handle,data,0,data.length,0);await call(sftp,"close",handle);assert.equal(fs.readFileSync(file,"utf8"),data.toString());
  await assert.rejects(()=>call(sftp,"open",path.join(root,"must-not-create"),"w"));assert(!fs.existsSync(path.join(root,"must-not-create")));record("existing_sftp_handle_finishes_but_new_file_open_is_refused");
  await assert.rejects(()=>execute(original,process.platform==="win32"?'Write-Output must-not-run':'printf must-not-run'));record("old_transport_cannot_start_another_command");sftp.end();
  const replacement=await connect(next), newTask=await execute(replacement,process.platform==="win32"?'Write-Output new-controller-ok':'printf new-controller-ok');const nextResult=await newTask.result;assert.equal(nextResult.code,0);assert(nextResult.stdout.includes("new-controller-ok"));
  const final=await long.result;assert.equal(final.code,0,final.stderr);assert.equal(final.stdout.replace(/[\r\n]/g,""),"startcomplete");record("original_inflight_command_finished_after_switch");
  await assert.rejects(()=>connect(report));record("old_controller_cannot_open_a_fresh_transport");
  const worker=agents.far.status().workerPid;
  await api("far","/unpair",{id:agents.a.identity.deviceId});await sleep(500);
  assert.equal(agents.far.status().workerPid,worker);
  const retained=await execute(replacement,process.platform==="win32"?'Write-Output retained-owner':'printf retained-owner');
  assert.equal((await retained.result).code,0);record("revoking_another_controller_keeps_current_owner_and_far_worker");
 } catch(error) { console.error(error.stack);fs.writeFileSync(path.join(root,"failure.txt"),error.stack);process.exitCode=1; }
 finally { for(const client of clients)client.destroy();for(const agent of Object.values(agents))await agent.close();if(echoServer.listening)await new Promise(r=>echoServer.close(r));console.log("ISOLATED_ROOT "+root); }
})();
