"use strict";
const {app,BrowserWindow,Tray,Menu,nativeImage,ipcMain,dialog,clipboard}=require("electron");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const {folder,read,write}=require("../src/pro/store.cjs"),lifecycle=require("../src/pro/client-lifecycle.cjs"),startup=require("../src/pro/autostart.cjs");
const args=process.argv.slice(1),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(__dirname,".."),profile=path.resolve(arg("--profile-dir",path.join(os.homedir(),".ssh-relay-pro-5.5")));
require("../src/pro/release.cjs").requireProfile(profile,{create:true});
const diagnostics=require("../src/pro/gui-diagnostics.cjs"),diagnosticDirectory=path.join(profile,"logs"),diagnostic=diagnostics.create(diagnosticDirectory);
diagnostics.installPipeGuards(diagnostic.record);
const forwarded=[...new Set([...args,...process.execArgv,...(app.commandLine.hasSwitch("inspect")?["--inspect="+app.commandLine.getSwitchValue("inspect")]:[])])].filter(value=>/^--(?:no-shortcuts|allow-cloud-self-test|disable-gpu|remote-debugging-port=\d+|inspect=\d+)$/.test(value));
function options(){return {executable:process.execPath,appRoot:root,profile,development:!app.isPackaged,args:forwarded};}
app.setName("SSH Relay Pro");app.setPath("userData",path.join(profile,"ui"));
if(!args.includes("--managed-client")){
  // The launcher has no backend. A separate parent owns and restores the client.
  lifecycle.launch({...options(),bootstrapPid:process.pid}).then(()=>app.exit(0)).catch(error=>{diagnostic.record("client_launch_failed",{reason:error.message});console.error(error.message);app.exit(1);});
}else if(!app.requestSingleInstanceLock())app.exit(0);
else{
  let window,tray,quitting=false,exiting=false,heartbeat,pollTimer,startupChanging=false,backendReady=false;
  const agentClient=require("../src/pro/agent-client.cjs"),statusPending=new Map(),seenAdmission=new Set();
  let prompting=false;
  if(process.platform==="win32")app.setAppUserModelId("rororo.ssh-relay.pro.5.5");
  if(process.platform==="linux"){app.setDesktopName("ssh-relay-pro-5.5.desktop");app.commandLine.appendSwitch("class","ssh-relay-pro");}
  app.on("second-instance",()=>show());
  function roleDirectory(role){return path.join(profile,role);}
  async function ensure(role){return agentClient.ensureAgent({dir:roleDirectory(role),role,allowCloudSelfTest:args.includes("--allow-cloud-self-test")});}
  function request(role,route,body){return agentClient.request(roleDirectory(role),route,body,body===undefined?{timeoutMs:5000}:{});}
  function statusRequest(role){
    if(!backendReady)return Promise.reject(Error("客户端正在迁移并启动连接服务"));
    if(!statusPending.has(role))statusPending.set(role,(async()=>{
      try{return await request(role,"/status");}catch(error){await ensure(role);return request(role,"/status");}
    })().finally(()=>statusPending.delete(role)));
    return statusPending.get(role);
  }
  function show(){if(!window||window.isDestroyed())createWindow();if(window.isMinimized())window.restore();window.show();window.focus();}
  function notice(message){window?.webContents.send("relay-notice",message);}
  function createWindow(){
    if(quitting)return;
    window=new BrowserWindow({width:1180,height:850,minWidth:860,minHeight:650,title:"SSH Relay Pro 5.5",icon:path.join(root,"assets/relay.ico"),
      webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.on("did-finish-load",()=>diagnostic.record("window_loaded"));
    window.webContents.on("render-process-gone",()=>{if(!quitting)setTimeout(()=>{if(window&&!window.isDestroyed())window.reload();},500);});
    window.loadFile(path.join(__dirname,"index.html")).catch(error=>diagnostic.record("window_load_failed",{reason:error.message}));
    window.on("close",event=>{if(!quitting){event.preventDefault();window.hide();}});
    window.on("closed",()=>{window=null;if(!quitting)setTimeout(createWindow,500);});
    window.on("show",()=>window.webContents.send("relay-visible"));
    window.webContents.setWindowOpenHandler(()=>({action:"deny"}));window.webContents.on("will-navigate",event=>event.preventDefault());
  }
  async function trayExit(){
    if(exiting||quitting)return;exiting=true;notice("正在关闭全部连接和所属进程…");
    try{
      await lifecycle.command(profile,"tray-exit",{pid:process.pid});
      quitting=true;clearInterval(heartbeat);clearInterval(pollTimer);tray?.destroy();tray=null;app.quit();
    }catch(error){exiting=false;show();notice("退出未完成："+error.message);await dialog.showMessageBox(window,{type:"error",message:"部分进程尚未退出，正在保留客户端以便继续清理",detail:error.message});}
  }
  module.exports={trayExit};
  function createTray(){
    tray=new Tray(nativeImage.createFromPath(path.join(root,"assets/relay-tray.png")));tray.setToolTip("SSH Relay Pro 5.5");
    tray.setContextMenu(Menu.buildFromTemplate([{label:"打开客户端",click:show},{label:"重连已启用电脑",click:async()=>{notice("正在重新连接…");try{await request("near","/retry",{});notice("重连请求已提交");}catch(error){notice(error.message);}}},{type:"separator"},{id:"tray-exit",label:"退出（关闭全部连接和进程）",click:()=>void trayExit()}]));tray.on("click",show);
  }
  const validSender=event=>event.sender===window?.webContents;
  const routes=new Set(["/status","/logs","/logs/clear","/pair/create","/pair/cancel","/pair/connect","/settings","/device","/controller","/unpair","/retry","/connection/decision"]);
  ipcMain.handle("relay",async(event,role,route,body)=>{
    if(!validSender(event)||!["near","far"].includes(role)||!routes.has(route)||exiting)throw Error("Invalid UI request");
    if(!backendReady)throw Error("客户端正在准备，请稍候");
    const value=route==="/status"?await statusRequest(role):await request(role,route,body);
    if(role==="far"&&route==="/status")void checkAdmission(value);return value;
  });
  ipcMain.handle("relay-batch",async(event,role,action,ids)=>{
    if(!validSender(event)||!["near","far"].includes(role)||!["connect","disconnect","unpair","retry"].includes(action)||!Array.isArray(ids)||ids.length>1000||!ids.every(id=>/^[a-f0-9-]{36}$/.test(id))||exiting)throw Error("Invalid batch request");
    const queue=[...new Set(ids)],results=[];let offset=0;
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
      while(offset<queue.length){const id=queue[offset++];try{
        if(action==="unpair")await request(role,"/unpair",{id});
        else await request(role,role==="near"?"/device":"/controller",{id,...(action==="retry"?{retry:true}:{enabled:action==="connect"})});
        results.push({id,ok:true});
      }catch(error){results.push({id,ok:false,error:error.message});}}
    }));return {results,succeeded:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
  });
  ipcMain.handle("pair-copy",async(event,code)=>{
    if(!validSender(event)||!/^55-\w{10}-\w{10}$/.test(code))throw Error("请先生成配对码");
    clipboard.writeText(code);return true;
  });
  ipcMain.handle("startup-status",event=>{if(!validSender(event))throw Error("Invalid sender");return startup.statusAsync(options());});
  ipcMain.handle("startup-set",async(event,value)=>{
    if(!validSender(event)||startupChanging)throw Error("启动设置正在保存");startupChanging=true;
    try{return await startup.apply(options(),value);}finally{startupChanging=false;}
  });
  ipcMain.handle("logs-export",async event=>{
    if(!validSender(event))throw Error("Invalid sender");
    const dest=await dialog.showSaveDialog(window,{defaultPath:"ssh-relay-pro-diagnostics-"+Date.now()+".json.gz"});
    if(dest.canceled)return false;
    await new Promise((resolve,reject)=>cp.execFile(process.execPath,[path.join(root,"src/pro/gui-diagnostics.cjs"),diagnosticDirectory,dest.filePath],{env:{...process.env,ELECTRON_RUN_AS_NODE:"1"},windowsHide:true,timeout:30000},error=>error?reject(Error("日志导出失败")):resolve()));return true;
  });
  async function checkAdmission(status){
    if(prompting||quitting||exiting)return;
    const pending=status.admission?.pending?.find(p=>p.expiresAt>Date.now()&&!seenAdmission.has(p.requestId));if(!pending)return;
    seenAdmission.add(pending.requestId);if(seenAdmission.size>128)seenAdmission.delete(seenAdmission.values().next().value);prompting=true;
    try{
      show();const ids=status.admission.connectedControllerIds||[],devices=ids.map(id=>status.devices.find(d=>d.id===id)||{id,label:id.slice(-8)});
      // Capacity replacement is selected inside the scrollable device list, not a 21-button OS dialog.
      window.webContents.send("relay-admission",{requestId:pending.requestId,label:String(pending.label||"已授权电脑").slice(0,80),expiresAt:pending.expiresAt,devices:devices.map(d=>({id:d.id,label:d.label}))});
    }finally{prompting=false;}
  }
  app.on("before-quit",event=>{if(!quitting){event.preventDefault();show();notice("请通过托盘菜单退出；关闭窗口只会收起客户端。");}});
  app.on("window-all-closed",()=>{if(!quitting&&!window)createWindow();});
  app.whenReady().then(async()=>{
    folder(profile);
    await require("./runtime-image-labels.cjs").prepareRuntimeImages(diagnostic.record);
    for(const role of ["near","far"]){const dir=folder(roleDirectory(role));write(path.join(dir,"client-owner.json"),{profile});if(!fs.existsSync(path.join(dir,"settings.json")))write(path.join(dir,"settings.json"),{enabled:false,autoConnect:true,label:os.hostname(),defaultDevice:null});}
    createWindow();createTray();
    const beat=async()=>{
      if(quitting||exiting)return;
      try{await lifecycle.command(profile,"heartbeat",{pid:process.pid});}
      catch{try{await lifecycle.launch({...options(),adoptPid:process.pid,sessionToken:process.env.SSH_RELAY_CLIENT_SESSION});}catch(error){diagnostic.record("client_guardian_recovery_failed",{reason:error.message});}}
    };
    await beat();heartbeat=setInterval(()=>void beat(),2000);
    try{await startup.prepareClientProfile(options());backendReady=true;await Promise.all(["near","far"].map(ensure));}
    catch(error){notice("启动尚未完成："+error.message);diagnostic.record("client_backend_start_failed",{reason:error.message});}
    if(!args.includes("--no-shortcuts"))try{await require("./shortcuts.cjs").install(options());}catch(error){diagnostic.record("shortcut_failed",{reason:error.message});}
    pollTimer=setInterval(()=>{if(!quitting&&!exiting&&window&&!window.isVisible())void statusRequest("far").then(checkAdmission).catch(()=>{});},3000);
  }).catch(error=>{diagnostic.record("client_start_failed",{reason:error.message});app.exit(1);});
}
