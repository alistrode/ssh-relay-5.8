"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  { pathToFileURL } = require("node:url");
function install({ executable, appRoot, profile, development }) {
  if (process.platform === "win32") {
    const q = (s) => "'" + s.replace(/'/g, "''") + "'";
    const script =
      "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'SSH Relay Pro.lnk'));$s.TargetPath=" +
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
    const r = cp.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    if (r.error || r.status !== 0)
      throw Error("Desktop shortcut could not be created");
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
    fs.writeFileSync(path.join(menu, "ssh-relay-pro.desktop"), entry, {
      mode: 0o755,
    });
    const xdg = cp.spawnSync("xdg-user-dir", ["DESKTOP"], { encoding: "utf8" }),
      desktop =
        xdg.status === 0 && xdg.stdout.trim()
          ? xdg.stdout.trim()
          : path.join(os.homedir(), "Desktop");
    fs.mkdirSync(desktop, { recursive: true });
    const link = path.join(desktop, "SSH-Relay-Pro");
    try {
      if (
        fs.lstatSync(link).isSymbolicLink() &&
        fs.readlinkSync(link) === executable
      )
        return;
      throw Error("Existing desktop file was preserved");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    fs.symlinkSync(executable, link);
    cp.spawnSync(
      "gio",
      [
        "set",
        link,
        "metadata::custom-icon",
        pathToFileURL(path.join(appRoot, "assets/relay.svg")).href,
      ],
      { stdio: "ignore" },
    );
  }
}
module.exports = { install };
