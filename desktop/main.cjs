"use strict";
const diagnostics = require("../src/pro/gui-diagnostics.cjs");
const startupPath = require("node:path"), startupOs = require("node:os");
const startupArgs = process.argv.slice(1), profileIndex = startupArgs.indexOf("--profile-dir");
const startupProfile = startupPath.resolve(profileIndex >= 0 && startupArgs[profileIndex + 1] ? startupArgs[profileIndex + 1] : startupPath.join(startupOs.homedir(), ".ssh-relay-pro"));
const diagnosticDirectory = startupPath.join(startupProfile, "logs");
const diagnostic = diagnostics.create(diagnosticDirectory);
diagnostics.installPipeGuards(diagnostic.record);
diagnostic.record("main_enter", { pid: process.pid, platform: process.platform });
// Monitor without swallowing fatal exceptions or changing Node's exit behavior.
process.on("uncaughtExceptionMonitor", () => diagnostic.record("uncaught_exception"));
process.on("exit", code => diagnostic.record("process_exit", { exitCode: code }));
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  shell,
  clipboard,
} = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  cp = require("node:child_process"),
  { folder, read, write } = require("../src/pro/store.cjs"),
  startup = require("../src/pro/autostart.cjs");
const root = path.resolve(__dirname, ".."),
  args = process.argv.slice(1),
  arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d),
  profile = path.resolve(
    arg("--profile-dir", path.join(os.homedir(), ".ssh-relay-pro")),
  );
let window,
  tray,
  quitting = false;
app.setName("SSH Relay Pro");
diagnostic.record("electron_loaded", { version: app.getVersion() });
app.on("child-process-gone", (_event, details) => diagnostic.record("child_process_gone", details));
app.on("render-process-gone", (_event, _contents, details) => diagnostic.record("render_process_gone", details));
if (process.platform === "win32") app.setAppUserModelId("rororo.ssh-relay.pro");
if (process.platform === "linux") {
  app.setDesktopName("ssh-relay-pro.desktop");
  app.commandLine.appendSwitch("class", "ssh-relay-pro");
}
app.setPath("userData", path.join(profile, "ui"));
if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", () => show());
function options() {
  return {
    executable: process.execPath,
    appRoot: root,
    profile,
    development: !app.isPackaged,
  };
}
const agentClient = require("../src/pro/agent-client.cjs");
function roleDirectory(role) {
  return role === "far" && args.includes("--far-state-dir")
    ? path.resolve(arg("--far-state-dir")) : path.join(profile, role);
}
function request(role, route, body) {
  return agentClient.request(roleDirectory(role), route, body,
    body === undefined ? { timeoutMs: 5000 } : {});
}
async function ensure(role) {
  await agentClient.ensureAgent({
    dir: roleDirectory(role), role,
    allowCloudSelfTest: args.includes("--allow-cloud-self-test"),
  });
}
const statusPending = new Map(), roleDisabled = new Map(), recoverAfter = new Map();
function statusRequest(role) {
  if (!statusPending.has(role)) {
    const task = request(role, "/status").catch(async error => {
      const transport = ["ECONNREFUSED", "ECONNRESET", "ENOENT"].includes(error.code) || ["Agent is not running", "Agent request timeout"].includes(error.message);
      if (!transport || args.includes("--observe-only") || Date.now() < (recoverAfter.get(role) || 0)) throw error;
      recoverAfter.set(role, Date.now() + 15000);
      await ensure(role);
      return request(role, "/status");
    }).then(value => {
      roleDisabled.set(role, !value.settings.enabled);
      return value;
    }).finally(() => statusPending.delete(role));
    statusPending.set(role, task);
  }
  return statusPending.get(role);
}
let prompting = false;
const seenAdmission = new Set();
async function checkAdmission(status) {
  if (prompting || quitting || args.includes("--observe-only")) return;
  const pending = status.admission?.pending?.find(p => p.expiresAt > Date.now() && !seenAdmission.has(p.requestId));
  if (!pending) return;
  prompting = true; seenAdmission.add(pending.requestId);
  if (seenAdmission.size > 128) seenAdmission.delete(seenAdmission.values().next().value);
  try { show(); await switchPrompt(pending, status); }
  catch { diagnostic.record("switch_prompt_unavailable"); }
  finally { prompting = false; }
}
function show() {
  if (window) {
    window.show();
    window.focus();
  }
}
function create() {
  diagnostic.record("window_create");
  window = new BrowserWindow({
    width: 1060,
    height: 780,
    minWidth: 820,
    minHeight: 620,
    title: "SSH Relay Pro",
    icon: path.join(root, "assets/relay.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("did-finish-load", () => diagnostic.record("window_loaded"));
  window.webContents.on("did-fail-load", (_e, errorCode) => diagnostic.record("window_load_failed", { errorCode }));
  window.on("show", () => diagnostic.record("window_shown"));
  window.loadFile(path.join(__dirname, "index.html")).catch(() => {
    diagnostic.record("window_load_rejected");
    app.exit(1);
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  if (args.includes("--tray")) window.hide();
  tray = new Tray(
    nativeImage.createFromPath(path.join(root, "assets/relay-tray.png")),
  );
  tray.setToolTip("SSH Relay Pro");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开连接界面", click: show },
      {
        label: "立即重试已配对电脑",
        click: () => request("near", "/retry", {}).catch(() => {}),
      },
      { type: "separator" },
      {
        label: "退出界面，保留后台连接",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
      {
        label: "关闭所有连接并退出",
        click: async () => {
          const managed = (await startup.statusAsync(options())).bootInstalled;
          await Promise.allSettled(
            ["near", "far"].map((r) => managed
              ? request(r, "/settings", {enabled:false}) : request(r, "/shutdown", {})),
          );
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", show);
}
const routes = new Set([
  "/status",
  "/logs",
  "/logs/clear",
  "/pair/create",
  "/pair/cancel",
  "/pair/connect",
  "/settings",
  "/device",
  "/controller",
  "/unpair",
  "/retry",
  "/connection/decision",
]);
ipcMain.handle("relay", async (event, role, route, body) => {
  if (
    event.sender !== window?.webContents ||
    !["near", "far"].includes(role) ||
    !routes.has(route)
  )
    throw Error("Invalid UI request");
  if (
    args.includes("--observe-only") &&
    route !== "/status" &&
    route !== "/logs"
  )
    throw Error("Read-only validation window");
  const result = route === "/status" ? await statusRequest(role) : await request(role, route, body);
  if (role === "far" && route === "/status") void checkAdmission(result);
  if (route === "/settings" && typeof body?.enabled === "boolean") roleDisabled.set(role, !body.enabled);
  if (route === "/logs/clear") require("../src/pro/manual-logs.cjs").clearLogs(diagnosticDirectory);
  return result;
});
ipcMain.handle("pair-copy", async (event, code) => {
  if (event.sender !== window?.webContents || !/^\w{10}-\w{10}$/.test(code))
    throw Error("Invalid pairing code");
  await clipboard.writeText(code);
  return true;
});
ipcMain.handle("startup-status", (event) => {
  if (event.sender !== window?.webContents) throw Error("Invalid sender");
  return startup.statusAsync(options());
});
let startupChanging = false;
ipcMain.handle("startup-set", async (event, value) => {
  if (event.sender !== window?.webContents) throw Error("Invalid sender");
  if (startupChanging) throw Error("启动设置正在保存，请稍候");
  startupChanging = true;
  try {
  const previous = await startup.statusAsync(options());
  const handover = process.platform === "win32" && value.enabled && value.mode === "boot" && !previous.bootInstalled;
  if (handover) {
    await Promise.allSettled(["near", "far"].map(role => request(role,"/shutdown",{})));
    const until = Date.now() + 15000;
    while (["near","far"].some(role => fs.existsSync(path.join(roleDirectory(role),"guardian.lock")))) {
      if (Date.now() >= until) throw Error("旧后台尚未退出，请稍后再试，未安装重叠服务。");
      await new Promise(resolve => setTimeout(resolve,200));
    }
  }
  try {
    const result = await startup.apply(options(), value);
    if (handover) await Promise.all(["near","far"].map(ensure));
    return result;
  } catch (error) {
    if (handover && !(await startup.statusAsync(options())).bootInstalled)
      await Promise.allSettled(["near","far"].map(ensure));
    throw error;
  }
  } finally { startupChanging = false; }
});
ipcMain.handle("logs-export", async () => {
  const d = await dialog.showSaveDialog(window, {
    defaultPath: "ssh-relay-pro-diagnostics-" + Date.now() + ".json.gz",
  });
  if (!d.canceled) await new Promise((resolve, reject) => {
    cp.execFile(process.execPath, [path.join(root, "src/pro/gui-diagnostics.cjs"), diagnosticDirectory, d.filePath],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 30000 },
      error => error ? reject(Error("日志导出失败，请保留本地日志")) : resolve());
  });
  return !d.canceled;
});
app.on("before-quit", () => { diagnostic.record("before_quit"); quitting = true; });
async function switchPrompt(pending, snapshot) {
  const label = String(pending.label || "已授权近端").replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").slice(0,80);
  const cancel = new AbortController();
  const timer = setTimeout(() => cancel.abort(), Math.max(1, pending.expiresAt - Date.now()));
  try {
    diagnostic.record("switch_prompt_shown");
    const status=snapshot || await request("far","/status");
    const connected=(status.admission?.connectedControllerIds || []).slice(0,5);
    const devices=connected.map(id=>status.devices.find(d=>d.id===id) || {id,label:id.slice(-8)});
    const response = await dialog.showMessageBox({
      title:"SSH Relay Pro — 五台连接已满", type:"question",
      buttons:["保留现有连接",...devices.map((d,i)=>"替换 " +(i+1))],
      defaultId:0,cancelId:0,signal:cancel.signal,
      message:"第六台电脑请求连接，请选择要替换的连接。",
      detail:"新请求："+label+"（"+pending.controllerId.slice(-8)+"）\n\n"+devices.map((d,i)=>(i+1)+". "+String(d.label||"已授权电脑").slice(0,60)+"（"+d.id.slice(-8)+"）").join("\n")+"\n\n选择后仅暂停指定电脑并接入新电脑，其他四台继续连接。关闭弹窗保留现有连接。",
    });
    const chosen=devices[response.response-1];
    await request("far", "/connection/decision", {requestId:pending.requestId,approve:!!chosen,replaceControllerId:chosen?.id});
    diagnostic.record(chosen ? "switch_prompt_approved" : "switch_prompt_declined");
  } finally { clearTimeout(timer); }
}
app.whenReady().then(async () => {
  diagnostic.record("app_ready");
  if (args.includes("--consent-only")) {
    try {
      const status = await request("far", "/status");
      const pending = status.admission?.pending?.find(p => p.expiresAt > Date.now());
      if (pending) await switchPrompt(pending);
    } catch { diagnostic.record("switch_prompt_unavailable"); }
    quitting = true; app.quit(); return;
  }
  folder(profile);
  // Fresh installations remain idle; existing settings and pairings are preserved.
  for (const role of ["near","far"]) {
    const file = path.join(roleDirectory(role),"settings.json");
    if (!fs.existsSync(file) && !args.includes("--observe-only"))
      write(file,{enabled:false,autoConnect:true,label:os.hostname(),defaultDevice:null});
  }
  create();
  let pollTimer;
  const poll = async () => {
    if (quitting) return;
    const visible = window && window.isVisible();
    if (visible) { pollTimer = setTimeout(poll, 3000); return; }
    await Promise.allSettled(["near", "far"].map(async role => {
      if (!visible && (role === "near" || roleDisabled.get(role))) return;
      try {
        const status = await statusRequest(role);
        if (!visible && role === "far") await checkAdmission(status);
      } catch { /* The visible renderer displays role-specific errors. */ }
    }));
    if (!quitting) pollTimer = setTimeout(poll, 3000);
  };
  window.on("show", () => window.webContents.send("relay-visible"));
  app.once("will-quit", () => clearTimeout(pollTimer));
  // Renderer owns visible refreshes. Main polls only while hidden for admission.
  const hiddenPoll = async () => {
    if (window?.isVisible()) { pollTimer = setTimeout(hiddenPoll, 3000); return; }
    await poll();
  };
  pollTimer = setTimeout(hiddenPoll, 3000);
  let diagnosticTimer;
  if (args.includes("--diagnostic-check")) {
    if (!args.includes("--observe-only") || !args.includes("--no-shortcuts")) throw Error("Diagnostic check requires an isolated read-only launch");
    diagnosticTimer = setTimeout(() => {
      diagnostic.record("startup_failed");
      quitting = true; app.exit(1);
    }, 120000);
  }
  if (
    !args.includes("--ui-smoke") &&
    !args.includes("--no-shortcuts") &&
    !args.includes("--observe-only")
  )
    try {
      await require("./shortcuts.cjs").install(options());
    } catch (error) {
      console.error("Shortcut: " + error.message);
    }
  if (!args.includes("--observe-only"))
    await Promise.allSettled(["near", "far"].map(ensure));
  if (args.includes("--observe-only")) {
    const capture = async () => {
      try {
        const status = await window.webContents.executeJavaScript(
          '({title:document.title,devices:document.querySelectorAll(".device").length,state:document.getElementById("refreshState").textContent})',
        );
        fs.writeFileSync(
          path.join(profile, "gui-status.json"),
          JSON.stringify({
            time: new Date().toISOString(),
            pid: process.pid,
            ...status,
          }),
        );
        if (args.includes("--diagnostic-check") || !fs.existsSync(path.join(profile, "observer.png")))
          fs.writeFileSync(
            path.join(profile, "observer.png"),
            (await window.webContents.capturePage()).toPNG(),
          );
        if (args.includes("--diagnostic-check")) {
          clearTimeout(diagnosticTimer); quitting = true; app.exit(0);
        }
      } catch (error) {
        fs.appendFileSync(
          path.join(profile, "gui-errors.log"),
          error.message + "\n",
        );
      }
    };
    setTimeout(capture, 8000);
    setInterval(capture, 30000);
  }
  if (args.includes("--ui-smoke")) {
    setTimeout(async () => {
      try {
        // All UI validation writes are confined to an explicitly isolated profile.
        if (!args.includes("--no-shortcuts"))
          throw Error("UI smoke requires --no-shortcuts and a private profile");
        const isolatedConfig = process.env.XDG_CONFIG_HOME;
        if (
          process.platform === "linux" &&
          (!isolatedConfig ||
            !path.resolve(isolatedConfig).startsWith(profile + path.sep))
        )
          throw Error(
            "UI smoke requires XDG_CONFIG_HOME below its private profile",
          );
        await window.webContents.executeJavaScript(
          'document.getElementById("offer").click(); true',
        );
        for (let i = 0; i < 60; i++) {
          if (
            await window.webContents.executeJavaScript(
              '!!document.getElementById("pairCode").textContent',
            )
          )
            break;
          await new Promise((r) => setTimeout(r, 500));
        }
        await window.webContents.executeJavaScript(
          'document.getElementById("copyCode").click(); true',
        );
        await new Promise((r) => setTimeout(r, 500));
        const displayed = await window.webContents.executeJavaScript(
          'document.getElementById("pairCode").textContent',
        );
        const copied = await clipboard.readText();
        if (!displayed || copied !== displayed)
          throw Error("Pair code copy failed");
        await clipboard.clear();
        await window.webContents.executeJavaScript(
          'document.getElementById("cancelCode").click(); true',
        );
        await new Promise((r) => setTimeout(r, 1000));
        if ((await request("far", "/status")).pairing?.active)
          throw Error("Pair code cancellation failed");
        await window.webContents.executeJavaScript(
          'document.getElementById("offer").click(); true',
        );
        let code;
        for (let i = 0; i < 60; i++) {
          code = await window.webContents.executeJavaScript(
            'document.getElementById("pairCode").textContent',
          );
          if (code) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!code) throw Error("UI did not create a pairing code");
        await window.webContents.executeJavaScript(
          'document.getElementById("code").value=' +
            JSON.stringify(code) +
            ';document.getElementById("pair").requestSubmit(); true',
        );
        let status;
        for (let i = 0; i < 120; i++) {
          status = await request("near", "/status");
          if (status.devices[0]?.state === "online") break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (status.devices[0]?.state !== "online")
          throw Error("UI pairing did not establish pinned SSH");
        await window.webContents.executeJavaScript(
          'refresh().then(()=>{document.getElementById("pairCode").textContent="";})',
        );
        const result = await window.webContents.executeJavaScript(
          '({title:document.title,ready:!!window.relay,buttons:document.querySelectorAll("button").length,rememberedDevices:document.querySelectorAll(".device").length})',
        );
        result.pairedSshVerified = true;
        result.copyAndCancelVerified = true;
        window.close();
        if (window.isDestroyed() || window.isVisible())
          throw Error("Window did not hide to tray");
        if ((await request("near", "/status")).devices[0]?.state !== "online")
          throw Error("Closing window stopped background");
        result.closeKeepsBackground = true;
        show();
        if (process.platform === "linux") {
          await window.webContents.executeJavaScript(
            'document.getElementById("startMode").value="login";document.getElementById("autoStart").checked=true;document.getElementById("autoStart").dispatchEvent(new Event("change"));true',
          );
          for (let i = 0; i < 40; i++) {
            if ((await startup.statusAsync(options())).enabled) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if (!(await startup.statusAsync(options())).loginInstalled)
            throw Error(
              "Login startup was not registered in isolated XDG profile",
            );
          window.reload();
          await new Promise((resolve) =>
            window.webContents.once("did-finish-load", resolve),
          );
          await new Promise((r) => setTimeout(r, 1000));
          if (
            !(await window.webContents.executeJavaScript(
              'document.getElementById("autoStart").checked',
            ))
          )
            throw Error("Startup setting was not remembered after UI reload");
          await window.webContents.executeJavaScript(
            'document.getElementById("autoStart").checked=false;document.getElementById("autoStart").dispatchEvent(new Event("change"));true',
          );
          for (let i = 0; i < 40; i++) {
            if (!(await startup.statusAsync(options())).enabled) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if ((await startup.statusAsync(options())).loginInstalled)
            throw Error("Isolated login startup was not removed");
          result.loginStartupRemembered = true;
          result.osBootRestartTested = false;
        }
        result.trayObjectCreated = !!tray;
        result.actualDesktopTrayHostTested = false;
        fs.writeFileSync(
          path.join(profile, "ui-smoke.json"),
          JSON.stringify(result),
        );
        fs.writeFileSync(
          path.join(profile, "ui-smoke.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
      } catch (error) {
        fs.writeFileSync(
          path.join(profile, "ui-smoke-error.txt"),
          error.message,
        );
      }
      await Promise.allSettled(
        ["near", "far"].map((r) => request(r, "/shutdown", {})),
      );
      quitting = true;
      app.quit();
    }, 5000);
  }
}).catch(() => {
  diagnostic.record("startup_failed");
  app.exit(1);
});
app.on("window-all-closed", () => {});

