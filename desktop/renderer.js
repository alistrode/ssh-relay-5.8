"use strict";
const $=id=>document.getElementById(id),states={online:"已连接",waiting:"等待连接",connecting:"正在连接",retrying:"自动重连中",disconnected:"已断开",identity_error:"设备身份或授权需要核对",starting:"正在启动",running:"运行中",remote_busy:"等待远端确认",remote_full:"远端 20 台连接已满",remote_paused:"远端已暂停此连接",slot_paused:"20 台名额已满",unsupported_remote:"远端需要升级"};
const rows={near:new Map(),far:new Map()},selected={near:new Set(),far:new Set()},snapshots={near:null,far:null},roleErrors=new Map(),batchBusy=new Set();
let nearEnabled=false,farEnabled=false,pairRevision=0,refreshTask,refreshAgain=false,refreshTimer,logsTask,logsTimer,lastStartup,admission;
const text=(node,value)=>{if(node.textContent!==String(value))node.textContent=String(value);};
function message(value,kind="info"){text($("message"),value);$("message").dataset.kind=kind;$("message").style.display="block";}
async function action(control,fn,success="操作已完成"){
  if(control?.disabled)return;
  const label=control?.textContent;
  if(control){control.disabled=true;control.dataset.busy="true";control.setAttribute("aria-busy","true");text(control,"处理中…");}
  message("正在处理…");
  try{const result=await fn();if(result!==false){message(typeof result==="string"?result:result?.message||success,result?.kind||"success");if(control){control.dataset.feedback="success";text(control,"✓ 完成");}}return result;}
  catch(error){message("操作未完成："+error.message,"error");if(control){control.dataset.feedback="error";text(control,"重试");}}
  finally{
    if(control){delete control.dataset.busy;control.removeAttribute("aria-busy");setTimeout(()=>{if(!control.isConnected)return;delete control.dataset.feedback;text(control,label);control.disabled=false;syncSelection("near");syncSelection("far");syncCode();},750);}
    void refresh();
  }
}
function button(label,fn){const b=document.createElement("button");b.type="button";b.className="secondary";b.textContent=label;b.onclick=()=>action(b,fn);return b;}
function syncCode(){const active=!!$("pairCode").textContent;for(const id of ["copyCode","cancelCode"])if(!$(id).dataset.busy&&!$(id).dataset.feedback)$(id).disabled=!active;}
function syncSelection(role){
  const toolbar=document.querySelector(`.batch-toolbar[data-role="${role}"]`),map=rows[role],set=selected[role];
  for(const id of set)if(!map.has(id))set.delete(id);
  for(const [id,entry]of map){entry.check.checked=set.has(id);entry.row.classList.toggle("selected",set.has(id));}
  const all=toolbar.querySelector("[data-select-all]");all.checked=map.size>0&&set.size===map.size;all.indeterminate=set.size>0&&set.size<map.size;
  text(toolbar.querySelector("[data-selection-count]"),`已选 ${set.size} / ${map.size} 台`);
  for(const b of toolbar.querySelectorAll("[data-batch]"))if(!b.dataset.busy&&!b.dataset.feedback)b.disabled=!set.size||batchBusy.has(role);
  for(const b of toolbar.querySelectorAll("[data-all]"))if(!b.dataset.busy&&!b.dataset.feedback)b.disabled=!map.size||batchBusy.has(role);
}
function renderRows(role,status){
  const container=$(role==="near"?"devices":"authorized"),map=rows[role],ids=new Set(status.devices.map(d=>d.id));
  for(const[id,entry]of map)if(!ids.has(id)){entry.row.remove();map.delete(id);}
  if(status.devices.length)container.querySelector(".empty-devices")?.remove();
  for(const d of status.devices){
    let entry=map.get(d.id);
    if(!entry){
      const row=document.createElement("div");row.className="device";row.dataset.id=d.id;
      const check=document.createElement("input");check.type="checkbox";check.setAttribute("aria-label","选择设备");
      const name=document.createElement("strong"),state=document.createElement("span"),info=document.createElement("p"),actions=document.createElement("div");actions.className="device-actions";
      entry={row,check,name,state,info,d};row.append(check,name,state,info,actions);
      check.onchange=()=>{check.checked?selected[role].add(d.id):selected[role].delete(d.id);syncSelection(role);};
      const call=(route,body)=>window.relay.call(role,route,{id:d.id,...body});
      entry.toggle=button("",async()=>{await call(role==="near"?"/device":"/controller",{enabled:!entry.d.enabled});return entry.d.enabled?"已断开此连接":"已提交连接请求";});actions.append(entry.toggle);
      if(role==="near")actions.append(button("设为默认",async()=>{await call("/device",{default:true,enabled:true});return "已设为默认电脑";}),button("重新连接",async()=>{await call("/device",{retry:true});return "重连请求已提交";}));
      actions.append(button(role==="near"?"取消配对":"取消授权",async()=>{if(!confirm(role==="near"?"取消这台电脑的配对？":"取消此电脑的授权并断开连接？"))return "已取消操作";await call("/unpair",{});return role==="near"?"配对已取消":"授权已取消";}));
      map.set(d.id,entry);container.append(row);
    }
    entry.d=d;text(entry.name,d.label||d.hostname||d.id.slice(-8));entry.check.setAttribute("aria-label","选择 "+(d.label||d.id.slice(-8)));
    text(entry.state,role==="near"?(states[d.state]||d.state):(d.connected?"已连接":d.enabled?"等待连接":"已暂停"));
    const system=d.system?.displayName||"系统版本待设备更新上报";
    text(entry.info,`${d.hostname||"设备"} · ${system} · ${d.id.slice(-8)}${status.settings.defaultDevice===d.id?" · 默认电脑":""}`);
    if(!entry.toggle.dataset.busy&&!entry.toggle.dataset.feedback)text(entry.toggle,role==="near"?(d.enabled?"断开此电脑":"连接此电脑"):(d.enabled?"断开此连接":"允许重新连接"));
  }
  if(!status.devices.length&&!container.querySelector(".empty-devices")){const empty=document.createElement("p");empty.className="empty-devices";empty.textContent="尚未配对电脑。";container.append(empty);}
  syncSelection(role);
}
async function refreshRole(role){
  const revision=pairRevision;
  try{
    const value=await window.relay.call(role,"/status");roleErrors.delete(role);snapshots[role]=value;
    if(value.system?.displayName)text($("localSystem"),"本机 · "+value.system.displayName);
    if(role==="near"){
      nearEnabled=value.settings.enabled;text($("nearState"),nearEnabled?"已开启 · 最多同时连接 20 台电脑":"已关闭 · 配对记录保留");
      if(!$("nearToggle").dataset.busy&&!$("nearToggle").dataset.feedback)text($("nearToggle"),nearEnabled?"关闭连接功能":"启用连接功能");
      $("nearControls").hidden=!nearEnabled;text($("nearCount"),value.devices.filter(d=>d.state==="online").length+" / 20 台已连接");
    }else{
      farEnabled=value.settings.enabled;if(!value.pairing?.active&&revision===pairRevision)text($("pairCode"),"");
      text($("farState"),farEnabled?"已允许连接 · "+(states[value.state]||value.state):"已关闭 · 本机不接受连接");
      if(!$("farToggle").dataset.busy&&!$("farToggle").dataset.feedback)text($("farToggle"),farEnabled?"关闭本机被连接":"允许连接本机");
      $("farControls").hidden=!farEnabled;text($("farCount"),(value.admission?.connectedControllerIds?.length||0)+" / 20 台已连接");
    }renderRows(role,value);syncCode();
  }catch(error){roleErrors.set(role,error.message);text($(role+"State"),"正在恢复客户端连接："+error.message);}
}
function refresh(){
  refreshAgain=true;if(refreshTask)return refreshTask;clearTimeout(refreshTimer);
  refreshTask=(async()=>{do{refreshAgain=false;await Promise.all([refreshRole("near"),refreshRole("far")]);}while(refreshAgain);text($("refreshState"),roleErrors.size?"正在准备连接":"客户端与连接服务在线");})().finally(()=>{refreshTask=null;if(!document.hidden)refreshTimer=setTimeout(refresh,3000);});return refreshTask;
}
async function refreshLogs(){
  clearTimeout(logsTimer);if(logsTask||document.hidden||!$("logPanel").open)return;
  logsTask=(async()=>{const results=await Promise.allSettled(["near","far"].map(async role=>{const value=await window.relay.call(role,"/logs");return value.events.map(e=>({...e,role}));}));const lines=results.flatMap((r,i)=>r.status==="fulfilled"?r.value:[{time:"",role:i?"far":"near",event:"日志暂不可读"}]);text($("logs"),lines.sort((a,b)=>a.time.localeCompare(b.time)).slice(-35).map(e=>[e.time,e.role,e.event,e.reason||""].join(" ")).join("\n"));})().finally(()=>{logsTask=null;if(!document.hidden&&$("logPanel").open)logsTimer=setTimeout(refreshLogs,5000);});return logsTask;
}
function resume(){if(!document.hidden){void refresh();void refreshLogs();}else{clearTimeout(refreshTimer);clearTimeout(logsTimer);}}
document.addEventListener("visibilitychange",resume);window.relay.onVisible(resume);window.relay.onNotice(message);
$("logPanel").ontoggle=()=>{$("logPanel").open?refreshLogs():clearTimeout(logsTimer);};
$("pair").onsubmit=event=>{event.preventDefault();void action($("pairButton"),async()=>{await window.relay.call("near","/pair/connect",{code:$("code").value.trim()});$("code").value="";return "配对已保存，正在自动连接";});};
$("offer").onclick=()=>action($("offer"),async()=>{const p=await window.relay.call("far","/pair/create",{}),revision=++pairRevision;text($("pairCode"),p.code);syncCode();setTimeout(()=>{if(revision===pairRevision){text($("pairCode"),"");syncCode();}},Math.max(0,p.expiresAt-Date.now()));return "配对码已生成，有效 24 小时，请仅交给可信电脑";});
$("copyCode").onclick=()=>action($("copyCode"),async()=>{await window.relay.copyCode($("pairCode").textContent);return "✓ 配对码已复制到剪贴板";});
$("cancelCode").onclick=()=>action($("cancelCode"),async()=>{await window.relay.call("far","/pair/cancel",{});pairRevision++;text($("pairCode"),"");return "有效配对码已取消";});
$("nearToggle").onclick=()=>action($("nearToggle"),()=>window.relay.call("near","/settings",{enabled:!nearEnabled}),nearEnabled?"连接功能已关闭":"连接功能已开启");
$("farToggle").onclick=()=>action($("farToggle"),()=>window.relay.call("far","/settings",{enabled:!farEnabled}),farEnabled?"本机被连接已关闭":"已允许连接本机");
$("retry").onclick=()=>action($("retry"),()=>window.relay.call("near","/retry",{}),"所有已启用电脑的重连请求已提交");
$("clearLogs").onclick=()=>action($("clearLogs"),async()=>{await window.relay.call("near","/logs/clear",{});await window.relay.call("far","/logs/clear",{});await refreshLogs();return "连接日志已清理，任务记录保留";});
$("export").onclick=()=>action($("export"),async()=>(await window.relay.exportLogs())?"脱敏日志已导出":"已取消导出");
function showStartup(value){lastStartup=value;$("autoStart").checked=value.enabled;$("autoStart").disabled=!!value.effectiveUnknown;$("saveStartup").disabled=!!value.effectiveUnknown||!!$("saveStartup").dataset.busy;text($("startupStatus"),value.effectiveUnknown?"暂时无法读取系统启动设置":value.enabled?"已启用：随系统启动完整客户端":"未启用自动启动；可手动打开客户端");}
$("saveStartup").onclick=()=>action($("saveStartup"),async()=>{try{showStartup(await window.relay.setStartup({enabled:$("autoStart").checked,mode:"client"}));return "客户端启动设置已保存";}catch(error){if(lastStartup)showStartup(lastStartup);throw error;}});
window.relay.startup().then(showStartup).catch(error=>message(error.message,"error"));
for(const toolbar of document.querySelectorAll(".batch-toolbar")){
  const role=toolbar.dataset.role;
  toolbar.querySelector("[data-select-all]").onchange=event=>{selected[role]=event.target.checked?new Set(rows[role].keys()):new Set();syncSelection(role);message(event.target.checked?"已全选设备":"已取消全选");};
  toolbar.querySelector("[data-clear]").onclick=event=>action(event.currentTarget,async()=>{selected[role].clear();syncSelection(role);return "已取消选择";});
  toolbar.querySelector("[data-box]").onclick=event=>{const b=event.currentTarget,enabled=b.getAttribute("aria-pressed")!=="true";b.setAttribute("aria-pressed",String(enabled));document.querySelector(`[data-device-role="${role}"]`).classList.toggle("box-mode",enabled);message(enabled?"框选已开启：在设备列表中拖动选择，可按 Ctrl 追加":"框选已关闭");};
  for(const b of toolbar.querySelectorAll("[data-batch],[data-all]"))b.onclick=()=>action(b,async()=>{
    if(batchBusy.has(role))return "上一批操作正在处理";
    const kind=b.dataset.batch||b.dataset.all,ids=b.dataset.all?[...rows[role].keys()]:[...selected[role]];
    if(!ids.length)return "请先选择设备";
    if(kind==="unpair"&&!confirm(`确认取消 ${ids.length} 台电脑的${role==="near"?"配对":"授权"}？这些连接将断开。`))return "已取消操作";
    batchBusy.add(role);syncSelection(role);
    try{const value=await window.relay.batch(role,kind,ids);const errors=value.results.filter(r=>!r.ok).map(r=>`${r.id.slice(-8)}：${r.error}`).join("；");return {message:`已处理 ${ids.length} 台：成功 ${value.succeeded}，未完成 ${value.failed}${errors?" · "+errors:""}`,kind:value.failed?"error":"success"};}
    finally{batchBusy.delete(role);syncSelection(role);}
  });
}
for(const container of document.querySelectorAll("[data-device-role]")){
  const role=container.dataset.deviceRole;let drag;
  container.addEventListener("pointerdown",event=>{
    if(event.button!==0||!container.classList.contains("box-mode")||event.target.closest("button,input,label"))return;
    event.preventDefault();container.setPointerCapture(event.pointerId);
    const box=document.createElement("div");box.className="selection-box";document.body.append(box);
    drag={x:event.clientX,y:event.clientY,base:event.ctrlKey||event.metaKey?new Set(selected[role]):new Set(),box};
  });
  container.addEventListener("pointermove",event=>{
    if(!drag)return;const x=Math.min(drag.x,event.clientX),y=Math.min(drag.y,event.clientY),right=Math.max(drag.x,event.clientX),bottom=Math.max(drag.y,event.clientY);
    drag.box.style.left=x+"px";drag.box.style.top=y+"px";drag.box.style.width=(right-x)+"px";drag.box.style.height=(bottom-y)+"px";
    selected[role]=new Set(drag.base);for(const[id,entry]of rows[role]){const rect=entry.row.getBoundingClientRect();if(rect.right>=x&&rect.left<=right&&rect.bottom>=y&&rect.top<=bottom)selected[role].add(id);}syncSelection(role);
  });
  const finish=()=>{if(drag){drag.box.remove();drag=null;syncSelection(role);message(`框选完成，已选 ${selected[role].size} 台`);}};container.addEventListener("pointerup",finish);container.addEventListener("pointercancel",finish);
}
window.relay.onAdmission(value=>{admission=value;$("admissionPanel").hidden=false;text($("admissionMessage"),`新请求：${value.label}。选择替换一台，其余 19 台保持连接。`);$("replaceController").replaceChildren(...value.devices.map(d=>{const option=document.createElement("option");option.value=d.id;option.textContent=d.label+" · "+d.id.slice(-8);return option;}));});
for(const[id,approve]of [["admissionApprove",true],["admissionDecline",false]])$(id).onclick=()=>action($(id),async()=>{if(!admission)return "请求已结束";await window.relay.call("far","/connection/decision",{requestId:admission.requestId,approve,replaceControllerId:approve?$("replaceController").value:undefined});$("admissionPanel").hidden=true;admission=null;return approve?"已替换指定连接":"已保留现有连接";});
void refresh();
