"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const execFile = require("node:util").promisify(cp.execFile);
async function install({ executable, appRoot, profile, development }) {
  if (process.platform === "win32") {
    const q = (s) => "'" + s.replace(/'/g, "''") + "'";
    const script =
      "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'SSH Relay Pro 5.5.lnk'));$s.TargetPath=" +
      q(executable) +
      ";$s.Arguments=" +
      q(
        (development ? '"' + appRoot + '" ' : "") +
          '--profile-dir "' +
          profile +
          '"',
      ) +
      ";$s.WorkingDirectory=" +
      q(appRoot) +
      ";$s.IconLocation=" +
      q(path.join(appRoot, "assets/relay.ico") + ",0") +
      ";$s.Save()";
    await execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
  } else if (process.platform === "linux") {
    const { linuxLogin } = require("../src/pro/autostart.cjs");
    const menu = path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
      "applications",
    );
    fs.mkdirSync(menu, { recursive: true, mode: 0o700 });
    const entry = linuxLogin({ executable, appRoot, profile, development })
      .replace(/ --tray\n/, "\n")
      .replace(
        "X-GNOME-Autostart-enabled=true",
        "StartupWMClass=ssh-relay-pro",
      );
    fs.writeFileSync(path.join(menu, "ssh-relay-pro-5.5.desktop"), entry, {
      mode: 0o755,
    });
    const xdg = await execFile("xdg-user-dir", ["DESKTOP"], { encoding: "utf8", timeout: 5000 }).catch(() => ({ stdout: "" }));
    const desktop = xdg.stdout.trim() || path.join(os.homedir(), "Desktop");
    fs.mkdirSync(desktop, { recursive: true });
    const link = path.join(desktop, "SSH-Relay-Pro-5.5");
    try {
      if (
        fs.lstatSync(link).isSymbolicLink() &&
        fs.readlinkSync(link) === executable
      )
        return;
      throw Error("Existing desktop file was preserved");
    } catch (e) { require('../src/pro/runtime-log.cjs').captureCaught(e,{component:'shortcuts.cjs',line:63});
      if (e.code !== "ENOENT") throw e;
    }
    fs.symlinkSync(executable, link);
    await execFile(
      "gio",
      [
        "set",
        link,
        "metadata::custom-icon",
        pathToFileURL(path.join(appRoot, "assets/relay.svg")).href,
      ],
      { timeout: 5000 },
    ).catch(() => {});
  }
}
module.exports = { install };
