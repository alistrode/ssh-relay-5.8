'use strict';
// Real native Windows dialog with a private, synthetic capacity fixture.
// Actual five-controller transports are covered by admission-integration.cjs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
if(process.platform!=='win32')throw Error('Native Windows GUI required');
const exe=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const root=path.join(os.homedir(),'.ssh-relay-capacity-dialog-'+Date.now());fs.mkdirSync(root,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
const ps=s=>"'"+s.replace(/'/g,"''")+"'";
(async()=>{for(const choice of [-1,0,1,2,3,4]){
 const profile=path.join(root,String(choice)),far=path.join(profile,'far');fs.mkdirSync(far,{recursive:true});
 const token=crypto.randomBytes(32).toString('hex'),requestId=crypto.randomUUID(),ids=Array.from({length:5},()=>crypto.randomUUID());let decision;
 const pending={requestId,controllerId:crypto.randomUUID(),label:'新请求电脑（界面验证）',expiresAt:Date.now()+90000};
 const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);return res.end('{}');}res.setHeader('Content-Type','application/json');if(req.url==='/status')return res.end(JSON.stringify({devices:ids.map((id,i)=>({id,label:'已连接电脑 '+(i+1)})),admission:{mode:'concurrent',connectedControllerIds:ids,pending:[pending]}}));let body='';req.on('data',b=>body+=b);req.on('end',()=>{decision=JSON.parse(body);res.end('{}')});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.writeFileSync(path.join(far,'agent-runtime.json'),JSON.stringify({port:server.address().port,token}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=cp.spawn(exe,['--consent-only','--far-state-dir',far,'--profile-dir',profile,'--no-shortcuts'],{env,stdio:'ignore'});let exited=false;child.once('close',()=>exited=true);
 try{
 const button=choice<0?'保留现有连接':'替换 '+(choice+1),shot=path.join(out,'capacity-'+(choice<0?'retain':choice+1)+'.png');
 const script=`$ErrorActionPreference='Stop';$env:PSModulePath=$PSHOME+'\\Modules';Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;Add-Type -AssemblyName System.Drawing;$root=[Windows.Automation.AutomationElement]::RootElement;$p=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,${child.pid});for($i=0;$i -lt 90;$i++){$windows=$root.FindAll([Windows.Automation.TreeScope]::Children,$p);foreach($window in $windows){$c=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,${ps(button)});$b=$window.FindFirst([Windows.Automation.TreeScope]::Descendants,$c);if($b){$all=@('保留现有连接','替换 1','替换 2','替换 3','替换 4','替换 5');foreach($name in $all){$find=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,$name);if(-not $window.FindFirst([Windows.Automation.TreeScope]::Descendants,$find)){throw ('Missing choice '+$name)}};$r=$window.Current.BoundingRectangle;$bmp=New-Object Drawing.Bitmap([int]$r.Width,[int]$r.Height);$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen([int]$r.Left,[int]$r.Top,0,0,$bmp.Size);$bmp.Save(${ps(shot)},[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();for($depth=0;$b -and $depth -lt 5;$depth++){$pattern=$null;if($b.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke();exit 0};if($b.TryGetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$pattern) -and $pattern.Current.DefaultAction){$pattern.DoDefaultAction();exit 0};$b=[Windows.Automation.TreeWalker]::RawViewWalker.GetParent($b)}}};Start-Sleep -Milliseconds 500};exit 3`;
 const automation=cp.spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';automation.stderr.on('data',b=>errors+=b);const status=await new Promise((r,j)=>{const timer=setTimeout(()=>{automation.kill();j(Error('Native dialog automation timeout'))},60000);automation.once('close',code=>{clearTimeout(timer);r(code)})});assert.equal(status,0,errors);
 for(let i=0;i<40&&!decision;i++)await wait(250);
 const expected={requestId,approve:choice>=0};if(choice>=0)expected.replaceControllerId=ids[choice];assert.deepEqual(decision,expected);
 for(let i=0;i<40&&!exited;i++)await wait(250);assert(exited,'Dialog helper must exit');
 results.push({choice:choice<0?'retain':choice+1,allSixButtonsPresent:true,correctSelectedController:true,passed:true});fs.writeFileSync(path.join(out,'dialog-results.json'),JSON.stringify(results,null,2));console.log('PASS native capacity dialog '+button);
 }finally{if(!exited)child.kill();await new Promise(r=>server.close(r))}
}})().catch(e=>{fs.writeFileSync(path.join(out,'dialog-failure.txt'),e.stack);console.error(e.stack);process.exitCode=1});
