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
let farEnabled = false,
  nearEnabled = false,
  busy = false,
  pairRevision = 0;
function message(text) {
  $("message").textContent = text;
  $("message").style.display = "block";
}
async function action(fn) {
  try {
    await fn();
    await refresh();
  } catch (e) {
    message(e.message);
  }
}
function button(text, fn) {
  const b = document.createElement("button");
  b.className = "secondary";
  b.textContent = text;
  b.onclick = () => action(fn);
  return b;
}
async function refresh() {
  if (busy) return;
  busy = true;
  const observedPairRevision = pairRevision;
  try {
    const [near, far] = await Promise.all([
      window.relay.call("near", "/status"),
      window.relay.call("far", "/status"),
    ]);
    $("refreshState").textContent =
      "后台在线 · " + new Date().toLocaleTimeString();
    farEnabled = far.settings.enabled;
    nearEnabled = near.settings.enabled;
    if (!far.pairing?.active && observedPairRevision === pairRevision)
      $("pairCode").textContent = "";
    $("farState").textContent = farEnabled ? "已允许连接 · " + (states[far.state] || far.state) : "已关闭 · 本机不接受连接";
    $("farToggle").textContent = farEnabled ? "关闭本机被连接" : "允许连接本机";
    $("nearToggle").textContent = nearEnabled ? "关闭连接功能" : "启用连接功能";
    $("nearState").textContent = nearEnabled ? "已开启 · 最多同时连接五台电脑，断开互不影响" : "已关闭 · 配对记录保留";
    $("nearControls").hidden = !nearEnabled;
    $("farControls").hidden = !farEnabled;
    $("nearCount").textContent = near.devices.filter(d => d.state === "online").length + " / 5 台已连接";
    $("farCount").textContent = (far.admission?.connectedControllerIds?.length || 0) + " / 5 台已连接";
    $("devices").replaceChildren();
    for (const d of near.devices) {
      const row = document.createElement("div");
      row.className = "device";
      const name = document.createElement("strong");
      name.textContent = d.label;
      const state = document.createElement("span");
      state.textContent = states[d.state] || d.state;
      const info = document.createElement("p");
      info.textContent =
        d.hostname +
        " · " +
        d.target +
        " · " +
        d.id +
        (d.retryAt > Date.now()
          ? " · " + Math.ceil((d.retryAt - Date.now()) / 1000) + " 秒后重试"
          : "") +
        (near.settings.defaultDevice === d.id ? " · 默认电脑" : "");
      row.append(
        name,
        state,
        info,
        button(d.enabled ? "断开此电脑" : "连接此电脑", () =>
          window.relay.call("near", "/device", {
            id: d.id,
            enabled: !d.enabled,
          }),
        ),
        button("设为默认", () =>
          window.relay.call("near", "/device", {
            id: d.id,
            default: true,
            enabled: true,
          }),
        ),
        button("立即重试", () =>
          window.relay.call("near", "/device", { id: d.id, retry: true }),
        ),
        button("取消配对", async () => {
          if (confirm("移除这台电脑的本地配对记录？"))
            await window.relay.call("near", "/unpair", { id: d.id });
        }),
      );
      $("devices").append(row);
    }
    if (!near.devices.length)
      $("devices").textContent = "尚未配对电脑。配对成功后会自动保存在这里。";
    $("authorized").replaceChildren();
    for (const d of far.devices) {
      const p = document.createElement("p");
      p.className = "device";
      p.textContent = d.label + " · " + (d.connected ? "已连接" : d.enabled ? "等待连接" : "已暂停") + " · " + d.id.slice(-8);
      p.append(
        button(d.enabled ? "断开此连接" : "允许重新连接", () =>
          window.relay.call("far", "/controller", {id:d.id,enabled:!d.enabled})),
        button("撤销授权", async () => {
          if (confirm("撤销此近端授权并断开现有远端会话？"))
            await window.relay.call("far", "/unpair", { id: d.id });
        }),
      );
      $("authorized").append(p);
    }
    const logs = await Promise.all(
      ["near", "far"].map(async (role) => {
        const result = await window.relay.call(role, "/logs");
        return result.events.map((event) => ({ ...event, role }));
      }),
    );
    $("logs").textContent = logs
      .flat()
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-35)
      .map((x) =>
        [
          x.time,
          x.role === "near" ? "近端" : "远端",
          x.event,
          x.deviceId || "",
          x.reason || "",
          x.delayMs !== undefined ? "重试等待 " + x.delayMs + " ms" : "",
        ].join(" "),
      )
      .join("\n");
  } catch (e) {
    $("refreshState").textContent = "后台恢复中";
  } finally {
    busy = false;
  }
}
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
    pairRevision++;
    $("pairCode").textContent = p.code;
    message("配对码五分钟内有效，只使用一次；不要公开分享。");
    setTimeout(
      () => ($("pairCode").textContent = ""),
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
  $("installService").disabled = s.bootInstalled;
  $("installService").textContent = s.bootInstalled ? "管理员后台已安装" : "首次授权并安装管理员后台";
  $("serviceStatus").textContent = s.bootInstalled
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
setInterval(refresh, 3000);

$("copyCode").onclick = () =>
  action(() => window.relay.copyCode($("pairCode").textContent));
$("cancelCode").onclick = () =>
  action(() => window.relay.call("far", "/pair/cancel", {}));
$("autoStart").onchange = () => $("saveStartup").click();
$("startMode").onchange = () => {
  if ($("autoStart").checked) $("saveStartup").click();
};


$("clearLogs").onclick = () => action(async () => {
  await window.relay.call("near", "/logs/clear", {});
  await window.relay.call("far", "/logs/clear", {});
  message("已清理连接日志；任务状态和请求记录保留。");
});
