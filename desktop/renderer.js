"use strict";
const $ = (id) => document.getElementById(id),
  states = {
    online: "已连接",
    waiting: "等待连接",
    connecting: "正在连接",
    retrying: "自动重连中",
    disconnected: "已断开",
    identity_error: "设备身份或授权需要核对",
    starting: "后台启动中",
    running: "后台运行中",
    remote_busy: "远端正在被连接，等待远端确认切换",
    remote_full: "远端已连接五台电脑，等待空位",
    remote_paused: "远端已暂停此连接，等待远端允许",
    slot_paused: "五台名额已满，连接已暂停",
    unsupported_remote: "远端不支持占用探测，已阻止自动连接",
  };
let farEnabled = false, nearEnabled = false, pairRevision = 0;
let startupBusy = false, lastStartup;
let refreshTask, refreshAgain = false, refreshTimer, logsTask, logsTimer;
const roleErrors = new Map(), rows = {near:new Map(),far:new Map()};
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function message(value) { text($("message"), value); $("message").style.display = "block"; }
async function action(fn) {
  try { await fn(); await refresh(); }
  catch (e) { message(e.message.includes("timeout") ? "操作结果待确认，请查看最新连接状态。" : e.message); await refresh(); }
}
function button(label, fn) {
  const b=document.createElement("button"); b.className="secondary"; b.textContent=label;
  b.onclick=async()=>{
    const group=b.closest(".device") || b.parentElement;
    const controls=[...group.querySelectorAll("button")];
    if(controls.some(c=>c.dataset.pending))return;
    const previous=controls.map(c=>c.disabled);
    controls.forEach(c=>{c.dataset.pending="1";c.disabled=true;});
    try { await action(fn); }
    finally { controls.forEach((c,i)=>{delete c.dataset.pending;c.disabled=previous[i];}); }
  }; return b;
}
function renderRows(role, status) {
  const container=$(role==="near"?"devices":"authorized"), map=rows[role];
  const ids=new Set(status.devices.map(d=>d.id));
  for(const [id,entry] of map)if(!ids.has(id)){entry.row.remove();map.delete(id);}
  if(status.devices.length)container.querySelector(".empty-devices")?.remove();
  for(const d of status.devices){
    let entry=map.get(d.id);
    if(!entry){
      const row=document.createElement("div");row.className="device";
      const name=document.createElement("strong"),state=document.createElement("span"),info=document.createElement("p");
      entry={row,name,state,info,d}; row.append(name,state,info);
      const call=(route,body)=>window.relay.call(role,route,{id:d.id,...body});
      entry.toggle=button("",()=>call(role==="near"?"/device":"/controller",{enabled:!entry.d.enabled}));
      row.append(entry.toggle);
      if(role==="near")row.append(button("设为默认",()=>call("/device",{default:true,enabled:true})),button("立即重试",()=>call("/device",{retry:true})));
      row.append(button(role==="near"?"取消配对":"撤销授权",async()=>{
        if(confirm(role==="near"?"移除这台电脑的本地配对记录？":"撤销此近端授权并断开现有远端会话？"))await call("/unpair",{});
      }));
      map.set(d.id,entry);container.append(row);
    }
    entry.d=d;text(entry.name,d.label);
    text(entry.state,role==="near"?(states[d.state]||d.state):(d.connected?"已连接":d.enabled?"等待连接":"已暂停"));
    text(entry.info,role==="near"?`${d.hostname} · ${d.target} · ${d.id}${status.settings.defaultDevice===d.id?" · 默认电脑":""}`:d.id.slice(-8));
    text(entry.toggle,role==="near"?(d.enabled?"断开此电脑":"连接此电脑"):(d.enabled?"断开此连接":"允许重新连接"));
  }
  if(!status.devices.length && !container.querySelector(".empty-devices")){const empty=document.createElement("p");empty.className="empty-devices";empty.textContent="尚未配对电脑。配对记录会保存在这里。";container.append(empty);}
}
async function refreshRole(role) {
  const revision=pairRevision;
  try {
    const value=await window.relay.call(role,"/status");roleErrors.delete(role);
    if(role==="near"){
      nearEnabled=value.settings.enabled;
      text($("nearState"),nearEnabled?"已开启 · 最多同时连接五台电脑，断开互不影响":"已关闭 · 配对记录保留");
      text($("nearToggle"),nearEnabled?"关闭连接功能":"启用连接功能");
      $("nearControls").hidden=!nearEnabled;
      text($("nearCount"),value.devices.filter(d=>d.state==="online").length+" / 5 台已连接");
    } else {
      farEnabled=value.settings.enabled;
      if(!value.pairing?.active && revision===pairRevision)text($("pairCode"),"");
      text($("farState"),farEnabled?"已允许连接 · "+(states[value.state]||value.state):"已关闭 · 本机不接受连接");
      text($("farToggle"),farEnabled?"关闭本机被连接":"允许连接本机");
      $("farControls").hidden=!farEnabled;
      text($("farCount"),(value.admission?.connectedControllerIds?.length||0)+" / 5 台已连接");
    }
    renderRows(role,value);
  } catch(e){roleErrors.set(role,e.message);text($(role+"State"),"状态读取失败，保留上次显示："+e.message);}
}
function refresh() {
  refreshAgain=true;
  if(refreshTask)return refreshTask;
  clearTimeout(refreshTimer);
  refreshTask=(async()=>{
    do {refreshAgain=false;await Promise.all([refreshRole("near"),refreshRole("far")]);}while(refreshAgain);
    text($("refreshState"),roleErrors.size?[...roleErrors].map(([r,e])=>(r==="near"?"连接其他电脑":"允许连接本机")+"："+e).join("；"):"后台在线");
  })().finally(()=>{
    refreshTask=null;
    if(!document.hidden)refreshTimer=setTimeout(refresh,3000);
  });return refreshTask;
}
async function refreshLogs(){
  clearTimeout(logsTimer);
  if(logsTask || document.hidden || !$("logPanel").open)return;
  logsTask=(async()=>{
    const values=await Promise.allSettled(["near","far"].map(async role=>{
      const result=await window.relay.call(role,"/logs");return result.events.map(e=>({...e,role}));
    }));
    const lines=values.flatMap((r,i)=>r.status==="fulfilled"?r.value:[{time:"",role:i?"far":"near",event:"日志读取失败："+r.reason.message}]);
    text($("logs"),lines.sort((a,b)=>a.time.localeCompare(b.time)).slice(-35).map(x=>[x.time,x.role==="near"?"近端":"远端",x.event,x.deviceId||"",x.reason||""].join(" ")).join("\n"));
  })().finally(()=>{logsTask=null;if(!document.hidden && $("logPanel").open)logsTimer=setTimeout(refreshLogs,5000);});
  return logsTask;
}
function resume(){if(!document.hidden){refresh();refreshLogs();}else{clearTimeout(refreshTimer);clearTimeout(logsTimer);}}
document.addEventListener("visibilitychange",resume);
window.relay.onVisible(resume);
$("logPanel").ontoggle=()=>{$("logPanel").open?refreshLogs():clearTimeout(logsTimer);};
$("pair").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    $("pairButton").disabled = true;
    try {
      await window.relay.call("near", "/pair/connect", {
        code: $("code").value,
      });
      $("code").value = "";
      message("配对已保存，正在验证电脑身份并自动连接。");
    } finally {
      $("pairButton").disabled = false;
    }
  });
};
$("offer").onclick = () =>
  action(async () => {
    const p = await window.relay.call("far", "/pair/create", {});
    const revision = ++pairRevision;
    $("pairCode").textContent = p.code;
    message("每个配对码自生成起独立有效 24 小时，可重复配对；生成新码不影响旧码。不要公开分享。");
    setTimeout(
      () => { if (revision === pairRevision) $("pairCode").textContent = ""; },
      Math.max(0, p.expiresAt - Date.now()),
    );
  });
$("farToggle").onclick = () =>
  action(() => window.relay.call("far", "/settings", { enabled: !farEnabled }));
$("nearToggle").onclick = () =>
  action(() => window.relay.call("near", "/settings", { enabled: !nearEnabled }));
$("installService").onclick = () => action(async () => {
  $("installService").disabled = true;
  $("serviceStatus").textContent = "正在安装，请完成系统授权…";
  try {
    showStartup(await window.relay.setStartup({enabled:true,mode:"boot"}));
    message("管理员后台已安装并启动。以后正常打开即可，无需每次确认 UAC。");
  } finally { showStartup(await window.relay.startup()); }
});
$("retry").onclick = () =>
  action(() => window.relay.call("near", "/retry", {}));
$("export").onclick = () => action(() => window.relay.exportLogs());
$("saveStartup").onclick = () =>
  action(async () => {
    let s;
    try {
      s = await window.relay.setStartup({
        enabled: $("autoStart").checked,
        mode: $("startMode").value,
      });
    } catch (e) {
      showStartup(await window.relay.startup());
      throw e;
    }
    showStartup(s);
    message("已保存并核对自启动设置。");
  });
function showStartup(s) {
  lastStartup = s;
  ["saveStartup", "autoStart", "startMode"].map($).forEach(c => c.disabled = startupBusy || !!s.effectiveUnknown);
  $("installService").disabled = startupBusy || !!s.effectiveUnknown || s.bootInstalled;
  $("installService").textContent = s.effectiveUnknown ? "后台设置暂时无法读取" : s.bootInstalled ? "管理员后台已安装" : "首次授权并安装管理员后台";
  $("serviceStatus").textContent = s.effectiveUnknown ? "未能读取服务设置，请稍后重新打开界面" : s.bootInstalled
    ? (s.servicesRunning === false ? "服务已安装，当前未运行" : "服务已安装 · 无需重复 UAC")
    : "尚未安装 · Windows 首次安装确认一次 UAC";
  $("autoStart").checked = s.enabled;
  $("startMode").value = s.mode;
  $("startupStatus").textContent =
    "登录启动：" +
    (s.loginInstalled ? "已安装" : "未安装") +
    "；开机后台服务：" +
    (s.bootInstalled ? "已启用" : "未启用") +
    (s.effectiveUnknown ? "；系统状态暂时无法核实" : "");
}
window.relay
  .startup()
  .then(showStartup)
  .catch((e) => message(e.message));
refresh();


$("copyCode").onclick = () =>
  action(() => window.relay.copyCode($("pairCode").textContent));
$("autoStart").onchange = () => $("saveStartup").click();
$("startMode").onchange = () => {
  if ($("autoStart").checked) $("saveStartup").click();
};


$("clearLogs").onclick = () => action(async () => {
  await window.relay.call("near", "/logs/clear", {});
  await window.relay.call("far", "/logs/clear", {});
  message("已清理连接日志；任务状态和请求记录保留。");
});

for(const id of ["offer","cancelCode","farToggle","nearToggle","retry","clearLogs","export"]){
  const element=$(id), original=element.onclick;
  element.onclick=async()=>{if(element.disabled)return;element.disabled=true;try{await original();}finally{element.disabled=false;}};
}
for (const id of ["installService", "saveStartup"]) {
  const element = $(id), original = element.onclick;
  element.onclick = async () => {
    if (startupBusy || element.disabled) return;
    startupBusy = true;
    if (lastStartup) showStartup(lastStartup);
    try { await original(); }
    finally { startupBusy = false; if (lastStartup) showStartup(lastStartup); }
  };
}
