"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const {folder,read,write,text}=require("./store.cjs");
const ps=value=>"'"+String(value).replace(/'/g,"''")+"'";
const quote=value=>'"'+String(value).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/%/g,"%%")+'"';
function run(command,args,options={}){return new Promise((resolve,reject)=>cp.execFile(command,args,{...options,windowsHide:true,timeout:120000},(error,stdout,stderr)=>error?reject(Object.assign(Error(stderr?.trim()||error.message),{code:error.code})):resolve(stdout)));}
function windowsElevationCommand(body){return "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-EncodedCommand',"+ps(Buffer.from(body,"utf16le").toString("base64"))+");exit $p.ExitCode";}
function powershell(script){return run("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from("$ErrorActionPreference='Stop';$env:PSModulePath=$PSHOME+'\\Modules';"+script,"utf16le").toString("base64")]);}
function linuxLogin({executable,appRoot,profile,development}){return `[Desktop Entry]\nType=Application\nName=SSH Relay Pro 5.5\nExec=${quote(executable)} ${development?quote(appRoot)+" ":""}--profile-dir ${quote(profile)}\nIcon=${path.join(appRoot,"assets/relay.svg")}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;}
function linuxFile(){return path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),".config"),"autostart/ssh-relay-pro-5.5.desktop");}
async function statusAsync({profile}){
  const settings=read(path.join(profile,"startup.json"),{enabled:false,mode:"client"});
  if(process.platform==="linux")return {...settings,enabled:fs.existsSync(linuxFile()),mode:"client",clientOnly:true,supported:true};
  if(process.platform==="win32"){
    try{const value=JSON.parse(await powershell("$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'SSH Relay Pro 5.5.lnk';@{enabled=(Test-Path $p);elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}|ConvertTo-Json -Compress"));return {...settings,...value,mode:"client",clientOnly:true,supported:true};}
    catch{return {...settings,mode:"client",clientOnly:true,supported:true,effectiveUnknown:true};}
  }
  return {...settings,supported:false,clientOnly:true,mode:"client"};
}
async function migrateLegacy(options){
  const marker=path.join(options.profile,"client-only-5.5.json");
  if(read(marker,null)?.completed)return;
  if(process.platform==="win32"){
    const found=JSON.parse(await powershell("@(Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-near' OR Name='SSHRelayPro-far'\"|Select-Object Name,PathName)|ConvertTo-Json -Compress")||"[]");
    const prefix=path.join(options.profile,"services").replace(/\\/g,"/").toLowerCase()+"/";
    const services=[found].flat().filter(service=>service&&String(service.PathName).replace(/\\/g,"/").toLowerCase().includes(prefix));
    if(services.length){
      const body="$ErrorActionPreference='Stop';"+services.map(service=>"Stop-Service -Name "+ps(service.Name)+" -Force -ErrorAction SilentlyContinue;Set-Service -Name "+ps(service.Name)+" -StartupType Disabled;& sc.exe delete "+ps(service.Name)+";if($LASTEXITCODE){throw '旧服务删除失败'};").join("");
      await powershell(windowsElevationCommand(body));
    }
  }else if(process.platform==="linux"){
    const names=["near","far"].map(role=>"ssh-relay-pro-"+role+"-"+process.getuid()+".service").filter(name=>{const file=path.join("/etc/systemd/system",name);return fs.existsSync(file)&&["near","far"].some(role=>fs.readFileSync(file,"utf8").includes(quote(path.join(options.profile,role))));});
    if(names.length){
      const script="#!/bin/sh\nset -eu\n"+names.map(name=>"systemctl disable --now "+name+"\nrm -f /etc/systemd/system/"+name).join("\n")+"\nsystemctl daemon-reload\n";
      const file=path.join(folder(options.profile),"remove-legacy-services.sh");text(file,script);await run("pkexec",["/bin/sh",file]);
    }
  }
  await require("./client-lifecycle.cjs").stopBackends(options.profile,process.pid);
  write(marker,{completed:true,at:Date.now()});
}
async function apply(options,{enabled}){
  if(typeof enabled!=="boolean")throw Error("Invalid client startup setting");
  folder(options.profile);await migrateLegacy(options);
  if(process.platform==="linux"){
    if(enabled)text(linuxFile(),linuxLogin(options));else fs.rmSync(linuxFile(),{force:true});
  }else if(process.platform==="win32"){
    const {executable,appRoot,profile,development}=options;
    const script="$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'SSH Relay Pro 5.5.lnk';"+(enabled?"$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($p);$s.TargetPath="+ps(executable)+";$s.Arguments="+ps((development?'"'+appRoot+'" ':"")+'--profile-dir "'+profile+'"')+";$s.WorkingDirectory="+ps(appRoot)+";$s.IconLocation="+ps(path.join(appRoot,"assets/relay.ico")+",0")+";$s.Save()":"if(Test-Path $p){Remove-Item -LiteralPath $p}");
    await powershell(script);
  }else throw Error("Unsupported startup platform");
  write(path.join(options.profile,"startup.json"),{enabled,mode:"client",changedAt:Date.now()});return statusAsync(options);
}
module.exports={linuxLogin,windowsElevationCommand,statusAsync,apply,migrateLegacy};
