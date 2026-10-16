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
  };
let farEnabled = true,
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
    if (!far.pairing?.active && observedPairRevision === pairRevision)
      $("pairCode").textContent = "";
    $("farState").textContent = states[far.state] || far.state;
    $("farToggle").textContent = farEnabled ? "暂停远端" : "启用远端";
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
        button(d.enabled ? "断开并暂停自动连接" : "连接并记住", () =>
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
      p.textContent = "已授权：" + d.label + " · " + d.id;
      p.append(
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
