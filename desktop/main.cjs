"use strict";
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
  zlib = require("node:zlib"),
  { folder, read } = require("../src/pro/store.cjs"),
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
function request(role, route, body) {
  return new Promise((resolve, reject) => {
    const runtime = read(path.join(profile, role, "agent-runtime.json"), null);
    if (!runtime) return reject(Error("Background is not running"));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: runtime.port,
        path: route,
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + runtime.token,
          "Content-Type": "application/json",
        },
        timeout: 110000,
      },
      (res) => {
        let data = "";
        res.on("data", (x) => (data += x));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode !== 200)
              reject(Error(result.error || "Background request failed"));
            else resolve(result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("Background request timeout")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const starting = new Map();
function ensure(role) {
  if (starting.has(role)) return starting.get(role);
  const task = ensureActual(role).finally(() => starting.delete(role));
  starting.set(role, task);
  return task;
}
async function ensureActual(role) {
  try {
    await request(role, "/status");
    return;
  } catch {}
  const dir = folder(path.join(profile, role));
  const log = fs.openSync(path.join(dir, "bootstrap.log"), "a", 0o600);
  const child = cp.spawn(
    process.execPath,
    [
      path.join(root, "src/pro/guardian.cjs"),
      "--role",
      role,
      "--state-dir",
      dir,
      ...(args.includes("--allow-cloud-self-test")
        ? ["--allow-cloud-self-test"]
        : []),
    ],
    {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    },
  );
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      await request(role, "/status");
      return;
    } catch {}
  }
  throw Error(
    "Could not start " + role + " background; inspect private bootstrap.log",
  );
}
function show() {
  if (window) {
    window.show();
    window.focus();
  }
}
function create() {
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
  window.loadFile(path.join(__dirname, "index.html"));
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
        label: "停止本版本后台并退出",
        click: async () => {
          await Promise.allSettled(
            ["near", "far"].map((r) => request(r, "/shutdown", {})),
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
  "/pair/create",
  "/pair/cancel",
  "/pair/connect",
  "/settings",
  "/device",
  "/unpair",
  "/retry",
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
  if (!args.includes("--observe-only")) await ensure(role);
  return request(role, route, body);
});
ipcMain.handle("pair-copy", async (event, code) => {
  if (event.sender !== window?.webContents || !/^\w{10}-\w{10}$/.test(code))
    throw Error("Invalid pairing code");
  await clipboard.writeText(code);
  return true;
});
ipcMain.handle("startup-status", () => startup.status(options()));
ipcMain.handle("startup-set", async (event, value) => {
  if (event.sender !== window?.webContents) throw Error("Invalid sender");
  if (value.mode === "boot" && value.enabled) {
    const r = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["取消", "安装开机后台服务"],
      defaultId: 0,
      cancelId: 0,
      message: "开机无人登录也连接",
      detail:
        process.platform === "win32"
          ? "需要管理员授权。Windows 后台服务使用 SYSTEM 账户，与桌面账户的权限和目录不同；登录后才显示托盘。"
          : "需要管理员授权。后台服务使用当前账户；登录后才显示托盘。此操作只安装本升级版本的服务。",
    });
    if (r.response !== 1) throw Error("用户取消，原设置保留");
  }
  return startup.apply(options(), value);
});
ipcMain.handle("logs-export", async () => {
  const logs = await Promise.all(
    ["near", "far"].map((role) =>
      request(role, "/logs").catch(() => ({ events: [] })),
    ),
  );
  const d = await dialog.showSaveDialog(window, {
    defaultPath: "ssh-relay-pro-diagnostics.json.gz",
  });
  if (!d.canceled)
    fs.writeFileSync(
      d.filePath,
      zlib.gzipSync(
        JSON.stringify({
          version: app.getVersion(),
          createdAt: new Date().toISOString(),
          near: logs[0],
          far: logs[1],
        }),
      ),
      { mode: 0o600 },
    );
  return !d.canceled;
});
app.on("before-quit", () => (quitting = true));
app.whenReady().then(async () => {
  folder(profile);
  create();
  if (
    !args.includes("--ui-smoke") &&
    !args.includes("--no-shortcuts") &&
    !args.includes("--observe-only")
  )
    try {
      require("./shortcuts.cjs").install(options());
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
        if (!fs.existsSync(path.join(profile, "observer.png")))
          fs.writeFileSync(
            path.join(profile, "observer.png"),
            (await window.webContents.capturePage()).toPNG(),
          );
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
            if (startup.status(options()).enabled) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if (!startup.status(options()).loginInstalled)
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
            if (!startup.status(options()).enabled) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if (startup.status(options()).loginInstalled)
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
});
app.on("window-all-closed", () => {});
