"use strict";
// Exercise the real native Windows consent dialog against an isolated fake API.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(process.platform!=='win32')throw Error('Native Windows GUI required');
const exe=path.resolve(process.argv[2]),root=path.resolve(process.argv[3]);
if(fs.existsSync(root))throw Error('Use a new private test directory');fs.mkdirSync(root,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
(async()=>{for(const approve of [false,true]){
 const profile=path.join(root,approve?'approve':'decline'),far=path.join(profile,'far');fs.mkdirSync(far,{recursive:true});const token=crypto.randomBytes(32).toString('hex'),requestId=crypto.randomUUID();let decision;
 const pending={requestId,controllerId:crypto.randomUUID(),label:'Isolated competing controller',expiresAt:Date.now()+120000};
 const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);return res.end('{}');}res.setHeader('Content-Type','application/json');if(req.url==='/status')return res.end(JSON.stringify({admission:{pending:[pending]}}));let body='';req.on('data',b=>body+=b);req.on('end',()=>{decision=JSON.parse(body);res.end('{}');});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(far,'agent-runtime.json'),JSON.stringify({port:server.address().port,token}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=cp.spawn(exe,['--consent-only','--far-state-dir',far,'--profile-dir',profile,'--no-shortcuts'],{env,stdio:'ignore'});let exited=false;child.once('close',()=>exited=true);
 try{
  const button=approve?'允许切换':'保留当前连接';
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $root=[Windows.Automation.AutomationElement]::RootElement; $p=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,${child.pid}); for($i=0;$i -lt 100;$i++){ $windows=$root.FindAll([Windows.Automation.TreeScope]::Children,$p); foreach($window in $windows){$c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'${button}');$b=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$c);for($depth=0;$b -and $depth -lt 5;$depth++){if($b.Current.Name -eq '${button}'){$pattern=$null;if($b.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke();exit 0;};if($b.TryGetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$pattern) -and $pattern.Current.DefaultAction){$pattern.DoDefaultAction();exit 0;}};$b=[Windows.Automation.TreeWalker]::RawViewWalker.GetParent($b);}};Start-Sleep -Milliseconds 500;};exit 3`;
  const automation=cp.spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';automation.stderr.on('data',b=>errors+=b);const status=await new Promise((r,j)=>{const timer=setTimeout(()=>{automation.kill();j(Error('Native dialog automation timeout'));},90000);automation.once('close',code=>{clearTimeout(timer);r(code);});});assert.equal(status,0,errors);
  for(let i=0;i<40&&!decision;i++)await wait(250);assert.deepEqual(decision,{requestId,approve});
  for(let i=0;i<40&&!exited;i++)await wait(250);assert(exited,'Consent helper must exit');
  const events=fs.readFileSync(path.join(profile,'logs/gui.jsonl'),'utf8');assert(events.includes('switch_prompt_shown'));assert(events.includes(approve?'switch_prompt_approved':'switch_prompt_declined'));
  results.push({approve,passed:true});fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results));
  console.log('PASS native Windows dialog '+(approve?'approve':'retain')+' posts authenticated decision and exits');
 }finally{if(!exited)child.kill();await new Promise(r=>server.close(r));}
}})().catch(e=>{fs.writeFileSync(path.join(root,'failure.txt'),e.stack);console.error(e.stack);process.exitCode=1;});
