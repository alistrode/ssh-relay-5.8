"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  crypto = require("node:crypto"),
  { folder, write, read, text } = require("./store.cjs");
const quote = (s) =>
  '"' +
  String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%") +
  '"';
const shell = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const ps = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function run(command, args, options = {}) {
  return new Promise(resolve => {
    cp.execFile(command, args, { ...options, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, status: error ? (typeof error.code === "number" ? error.code : -1) : 0, error });
    });
  });
}
function windowsElevationCommand(body) {
  const encoded = Buffer.from(body, "utf16le").toString("base64");
  return (
    "$ErrorActionPreference='Stop';$env:PSModulePath=$PSHOME+'\\Modules';" +
    "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-EncodedCommand'," +
    ps(encoded) +
    ");exit $p.ExitCode"
  );
}
function linuxUnit({
  executable,
  appRoot,
  profile,
  role,
  user = os.userInfo().username,
}) {
  return `[Unit]\nDescription=SSH Relay Pro ${role}\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory=${String(appRoot).replace(/%/g, "%%")}\nEnvironment=ELECTRON_RUN_AS_NODE=1\nExecStart=${quote(executable)} ${quote(path.join(appRoot, "src/pro/guardian.cjs"))} --role ${role} --state-dir ${quote(path.join(profile, role))}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\n[Install]\nWantedBy=multi-user.target\n`;
}
function windowsXml({ executable, appRoot, profile, role, ownerSid }) {
  const x = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  if (!/^S-1-5-21-(\d+-){2}\d+-\d+$/.test(ownerSid || "")) throw Error("Cannot verify service profile owner SID");
  return `<service><id>SSHRelayPro-${role}</id><name>SSH Relay Pro ${role}</name><description>Authorized LocalSystem relay background service.</description><executable>${x(executable)}</executable><arguments>${x('"' + path.join(appRoot, "src/pro/guardian.cjs") + '" --role ' + role + ' --state-dir "' + path.join(profile, role) + '"')}</arguments><workingdirectory>${x(appRoot)}</workingdirectory><env name="ELECTRON_RUN_AS_NODE" value="1"/><env name="SSH_RELAY_STATE_OWNER_SID" value="${x(ownerSid)}"/><startmode>Automatic</startmode><onfailure action="restart" delay="5 sec"/><stoptimeout>20 sec</stoptimeout><log mode="roll-by-size"><sizeThreshold>1024</sizeThreshold><keepFiles>3</keepFiles></log></service>`;
}
function linuxLogin({ executable, appRoot, profile, development }) {
  return `[Desktop Entry]\nType=Application\nName=SSH Relay Pro\nExec=${quote(executable)} ${development ? quote(appRoot) + " " : ""}--profile-dir ${quote(profile)} --tray\nIcon=${path.join(appRoot, "assets/relay.svg")}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}
function status(options) {
  const { profile } = options,
    settings = read(path.join(profile, "startup.json"), {
      enabled: false,
      mode: "login",
    });
  if (process.platform === "linux") {
    const login = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "autostart/ssh-relay-pro.desktop",
    );
    const checks = ["near", "far"].map((role) =>
      cp
        .spawnSync(
          "systemctl",
          [
            "is-enabled",
            "ssh-relay-pro-" + role + "-" + process.getuid() + ".service",
          ],
          { encoding: "utf8", timeout: 5000 },
        )
        .stdout?.trim(),
    );
    return {
      ...settings,
      loginInstalled: fs.existsSync(login),
      bootInstalled: checks.every((v) => v === "enabled"),
      supported: true,
    };
  }
  if (process.platform === "win32") {
    const r = cp.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(
          "$env:PSModulePath=$PSHOME+'\\Modules';$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'SSH Relay Pro.lnk';$a=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-near'\" -ErrorAction SilentlyContinue;$b=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-far'\" -ErrorAction SilentlyContinue;@{loginInstalled=(Test-Path $p);bootInstalled=($a.StartMode -eq 'Auto' -and $b.StartMode -eq 'Auto');servicesRunning=($a.State -eq 'Running' -and $b.State -eq 'Running')}|ConvertTo-Json",
          "utf16le",
        ).toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    try {
      return { ...settings, ...JSON.parse(r.stdout), supported: true };
    } catch {
      return { ...settings, supported: true, effectiveUnknown: true };
    }
  }
  return { ...settings, supported: false };
}
async function statusAsync(options) {
  const { profile } = options,
    settings = read(path.join(profile, "startup.json"), {
      enabled: false,
      mode: "login",
    });
  if (process.platform === "linux") {
    const login = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "autostart/ssh-relay-pro.desktop",
    );
    const checks = await Promise.all(["near", "far"].map(async (role) =>
      (await run(
          "systemctl",
          [
            "is-enabled",
            "ssh-relay-pro-" + role + "-" + process.getuid() + ".service",
          ],
          { encoding: "utf8", timeout: 5000 },
        )).stdout?.trim(),
    ));
    return {
      ...settings,
      loginInstalled: fs.existsSync(login),
      bootInstalled: checks.every((v) => v === "enabled"),
      supported: true,
    };
  }
  if (process.platform === "win32") {
    const r = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(
          "$env:PSModulePath=$PSHOME+'\\Modules';$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'SSH Relay Pro.lnk';$a=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-near'\" -ErrorAction SilentlyContinue;$b=Get-CimInstance Win32_Service -Filter \"Name='SSHRelayPro-far'\" -ErrorAction SilentlyContinue;@{loginInstalled=(Test-Path $p);bootInstalled=($a.StartMode -eq 'Auto' -and $b.StartMode -eq 'Auto');servicesRunning=($a.State -eq 'Running' -and $b.State -eq 'Running')}|ConvertTo-Json",
          "utf16le",
        ).toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    try {
      return { ...settings, ...JSON.parse(r.stdout), supported: true };
    } catch {
      return { ...settings, supported: true, effectiveUnknown: true };
    }
  }
  return { ...settings, supported: false };
}
async function apply(options, { enabled, mode }) {
  if (typeof enabled !== "boolean" || !["login", "boot"].includes(mode))
    throw Error("Invalid autostart setting");
  const { executable, appRoot, profile, development } = options;
  folder(profile);
  if (process.platform === "linux") {
    const login = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "autostart/ssh-relay-pro.desktop",
    );

    if (mode === "boot" || (await statusAsync(options)).bootInstalled) {
      const stage = folder(
          path.join(
            profile,
            "service-install-" + crypto.randomBytes(4).toString("hex"),
          ),
        ),
        names = [];
      for (const role of ["near", "far"]) {
        const name =
          "ssh-relay-pro-" + role + "-" + process.getuid() + ".service";
        names.push(name);
        text(path.join(stage, name), linuxUnit({ ...options, role }));
      }
      const script = ["#!/bin/sh", "set -eu"];
      for (const name of names) {
        if (enabled && mode === "boot")
          script.push(
            "install -m 0644 " +
              shell(path.join(stage, name)) +
              " " +
              shell("/etc/systemd/system/" + name),
          );
      }
      script.push("systemctl daemon-reload");
      for (const name of names)
        script.push(
          "systemctl " +
            (enabled && mode === "boot" ? "enable" : "disable") +
            " " +
            shell(name),
        );
      text(path.join(stage, "install.sh"), script.join("\n") + "\n");
      const r = await run(
        "pkexec",
        ["/bin/sh", path.join(stage, "install.sh")],
        { encoding: "utf8", timeout: 120000 },
      );
      if (r.error || r.status !== 0)
        throw Error(
          "System service installation was not authorized or failed; autostart was not marked enabled",
        );
    }
    if (enabled) text(login, linuxLogin(options));
    else
      try {
        fs.unlinkSync(login);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
  } else if (process.platform === "win32") {
    let script;
    const loginScript =
      "$env:PSModulePath=$PSHOME+'\\Modules';$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'SSH Relay Pro.lnk';" +
      (enabled
        ? "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($p);$s.TargetPath=" +
          ps(executable) +
          ";$s.Arguments=" +
          ps(
            (development ? '"' + appRoot + '" ' : "") +
              '--profile-dir "' +
              profile +
              '" --tray',
          ) +
          ";$s.WorkingDirectory=" +
          ps(appRoot) +
          ";$s.IconLocation=" +
          ps(path.join(appRoot, "assets/relay.ico") + ",0") +
          ";$s.Save()"
        : "if(Test-Path $p){Remove-Item -LiteralPath $p}");
    // Desktop login preferences must not disable or reinstall the SYSTEM services.
    if (enabled && mode === "boot" && !(await statusAsync(options)).bootInstalled) {
      const stage = folder(path.join(profile, "services"));
      const winsw = path.join(appRoot, "vendor/WinSW-x64.exe");
      if (!fs.existsSync(winsw))
        throw Error("Bundled Windows service host missing");
      script = "$ErrorActionPreference='Stop';";
      const identity = await run("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding:"utf8", windowsHide:true, timeout:10000 });
      const ownerSid = /S-1-5-21-(?:\d+-){2}\d+-\d+/.exec(identity.stdout || "")?.[0];
      if (!ownerSid) throw Error("Cannot verify the current Windows account");
      // Both the desktop owner and SYSTEM must be able to use this one profile.
      // Do not change permissions outside this application's private directories.
      script += "$sid=" + ps(ownerSid) + ";";
      for (const role of ["near", "far"]) {
        const state = folder(path.join(profile, role));
        script += "$state=" + ps(state) + ";$items=@(Get-Item -LiteralPath $state)+@(Get-ChildItem -LiteralPath $state -Force -Recurse);foreach($item in $items){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Private profile contains a reparse point'};if($item.PSIsContainer){$acl=New-Object Security.AccessControl.DirectorySecurity;$flags=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object Security.AccessControl.FileSecurity;$flags=[Security.AccessControl.InheritanceFlags]::None};$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new($sid));foreach($grant in @($sid,'S-1-5-18','S-1-5-32-544')){$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($grant),[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $item.FullName -AclObject $acl};";
      }
      for (const role of ["near", "far"]) {
        const exe = path.join(stage, "SSHRelayPro-" + role + ".exe");
        if (!fs.existsSync(exe)) fs.copyFileSync(winsw, exe);
        const config = exe.replace(/\.exe$/, ".xml");
        const xml = windowsXml({ ...options, role, ownerSid });
        if (fs.existsSync(config) && fs.readFileSync(config,"utf8") !== xml)
          throw Error("Service paths changed; use the original installed folder or uninstall the previous services first");
        text(config, xml);
        if (enabled && mode === "boot")
          script +=
            "if(-not(Get-Service -Name 'SSHRelayPro-" +
            role +
            "' -ErrorAction SilentlyContinue)){& " +
            ps(exe) +
            " install;if($LASTEXITCODE){throw 'Service installation failed'}};Set-Service -Name 'SSHRelayPro-" +
            role +
            "' -StartupType Automatic;Start-Service -Name 'SSHRelayPro-" + role + "';";
        else
          script +=
            "$s=Get-Service -Name 'SSHRelayPro-" +
            role +
            "' -ErrorAction SilentlyContinue;if($s){Set-Service -Name $s.Name -StartupType Manual};";
      }
      const file = path.join(stage, "configure.ps1"),
        result = path.join(stage, "result.txt");
      const failure = path.join(stage, "install-error.txt");
      const installBody =
        "$ErrorActionPreference='Stop';$env:PSModulePath=$PSHOME+'\\Modules';try{" + script +
        "\n'DONE' | Set-Content -LiteralPath " + ps(result) +
        "}catch{($_.Exception.Message | Out-String) | Set-Content -LiteralPath " + ps(failure) + ";exit 1}";
      // Keep a readable audit file; execute typed commands without changing OS script policy.
      text(file, Buffer.from("\ufeff" + installBody, "utf16le"));
      try {
        fs.unlinkSync(result);
      } catch {}
      try { fs.unlinkSync(failure); } catch {}
      script = windowsElevationCommand(installBody);
      const r = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 120000 },
      );
      if (r.error || r.status !== 0 || !fs.existsSync(result)) {
        const detail = fs.existsSync(failure) ? fs.readFileSync(failure,"utf8").trim().slice(0,1000) : "";
        throw Error("Windows service setup was not authorized or failed" + (detail ? ": " + detail : ""));
      }
      script = null;
    }
    script = loginScript;
    if (script) {
      const r = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30000 },
      );
      if (r.error || r.status !== 0)
        throw Error("Windows login autostart failed");
    }
  } else throw Error("Unsupported autostart platform");
  write(path.join(profile, "startup.json"), {
    enabled,
    mode,
    changedAt: Date.now(),
  });
  return statusAsync(options);
}
module.exports = {
  linuxUnit,
  windowsXml,
  linuxLogin,
  windowsElevationCommand,
  status,
  statusAsync,
  apply,
};
