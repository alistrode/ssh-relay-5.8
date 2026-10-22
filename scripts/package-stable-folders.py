#!/usr/bin/env python3
"""Copy the verified application and pinned runtimes into role-specific folders."""
import hashlib, json, os, shutil, subprocess, sys, tarfile, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUTS, OUT = map(lambda s: Path(s).resolve(), sys.argv[1:3])
PLATFORM = sys.argv[3]
NODE = '24.22.0'
ELECTRON = '44.8.0'
pins = {
    'node-v24.22.0-linux-x64.tar.xz': 'cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008',
    'node-v24.22.0-win-x64.zip': 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
    'electron-v44.8.0-linux-x64.zip': '926679355f8bf8d521fc6e1a2dc1c71f11cf176a3a1444f9afbd9e1cdfeddb11',
    'electron-v44.8.0-win32-x64.zip': '1c9319bab793492715f7668e0be0e6a30bf2a8577275e40035bd33601bf6f573',
}
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
node_file = f'node-v{NODE}-' + ('win-x64.zip' if PLATFORM == 'windows' else 'linux-x64.tar.xz')
electron_file = f'electron-v{ELECTRON}-' + ('win32-x64.zip' if PLATFORM == 'windows' else 'linux-x64.zip')
for name in [node_file, electron_file]:
    if digest(INPUTS / name) != pins[name]: raise RuntimeError('Runtime hash mismatch: ' + name)
subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'ls', '--omit=dev', '--all'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL, shell=os.name == 'nt')
OUT.mkdir(parents=True, exist_ok=True)
for role in ['near', 'far']:
    name = 'SSHRelay-' + role + '-' + PLATFORM + '-x64'
    folder = OUT / name
    if folder.exists(): shutil.rmtree(folder)
    folder.mkdir()
    with zipfile.ZipFile(INPUTS / electron_file) as z:
        z.extractall(folder)
        for entry in z.infolist():
            if entry.external_attr >> 16 & 0o111: (folder / entry.filename).chmod(0o755)
    original = folder / ('electron.exe' if PLATFORM == 'windows' else 'electron')
    original.rename(folder / ('SSHRelayPro.exe' if PLATFORM == 'windows' else 'ssh-relay-pro'))
    (folder / 'resources/default_app.asar').unlink(missing_ok=True)
    app = folder / 'resources/app'
    app.mkdir(parents=True)
    for directory in ['src', 'desktop', 'assets', 'profiles', 'launchers']:
        shutil.copytree(ROOT / directory, app / directory)
    for item in ['package.json', 'package-lock.json']:
        shutil.copyfile(ROOT / item, app / item)
    # Copy the actual complete production tree; no hand-picked dependency trimming.
    shutil.copytree(ROOT / 'node_modules', app / 'node_modules', symlinks=True)
    runtime = folder / 'runtime'
    runtime.mkdir()
    if PLATFORM == 'windows':
        with zipfile.ZipFile(INPUTS / node_file) as z:
            for item in ['node.exe', 'LICENSE']:
                (runtime / item).write_bytes(z.read(f'node-v{NODE}-win-x64/' + item))
    else:
        with tarfile.open(INPUTS / node_file) as t:
            for item, target in [('bin/node', 'node'), ('LICENSE', 'LICENSE')]:
                (runtime / target).write_bytes(t.extractfile(f'node-v{NODE}-linux-x64/' + item).read())
        (runtime / 'node').chmod(0o755)
    vendor = INPUTS / 'vendor'
    if vendor.exists(): shutil.copytree(vendor, folder / 'vendor', symlinks=True)
    if PLATFORM == 'windows':
        winsw = INPUTS / 'WinSW.NET4.exe'
        if digest(winsw) != '923111c7142b3dc783a3c722b19b8a21bcb78222d7a136ac33f0ca8a29f4cb66': raise RuntimeError('WinSW hash mismatch')
        (app / 'vendor').mkdir()
        shutil.copyfile(winsw, app / 'vendor/WinSW-x64.exe')
        shutil.copyfile(INPUTS / 'WinSW-LICENSE', app / 'vendor/LICENSE.WinSW')
        for filename, arguments in {'Start.cmd': '', 'Stop.cmd': '--cli stop', 'Status.cmd': '--cli status', 'CLI.cmd': '--cli %*', 'MCP.cmd': '--mcp %*'}.items():
            data = '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0runtime\\node.exe" "%~dp0resources\\app\\launchers\\portable-entry.cjs" ' + arguments + '\r\n'
            if filename in ['Start.cmd', 'Stop.cmd', 'Status.cmd']: data += 'pause\r\n'
            (folder / filename).write_bytes(data.encode())
        (folder / 'Open-UI.cmd').write_bytes(b'@echo off\r\nsetlocal DisableDelayedExpansion\r\nset ELECTRON_RUN_AS_NODE=\r\n"%~dp0SSHRelayPro.exe" --no-shortcuts %*\r\n')
    else:
        for filename, arguments in {'Start.sh': '', 'Stop.sh': '--cli stop', 'Status.sh': '--cli status', 'CLI.sh': '--cli "$@"', 'MCP.sh': '--mcp "$@"'}.items():
            (folder / filename).write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexec "$ROOT/runtime/node" "$ROOT/resources/app/launchers/portable-entry.cjs" ' + arguments + '\n')
            (folder / filename).chmod(0o755)
        (folder / 'Open-UI.sh').write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nunset ELECTRON_RUN_AS_NODE\nexec "$ROOT/ssh-relay-pro" --no-shortcuts "$@"\n')
        (folder / 'Open-UI.sh').chmod(0o755)
    manifest = {'role': role, 'platform': PLATFORM, 'architecture': 'x64', 'node': NODE, 'electron': ELECTRON,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'verifiedBusinessSource': '912d073ce859184aa6006c3d8829aaa71df87430',
        'lockfileSHA256': digest(app / 'package-lock.json'), 'runtimeArchives': {n: pins[n] for n in [node_file, electron_file]},
        'stateDirectory': '~/.ssh-relay-pro/' + role, 'credentialsIncluded': False}
    (folder / 'PACKAGE.json').write_text(json.dumps(manifest, indent=2) + '\n')
    label = '近端' if role == 'near' else '远端'
    (folder / 'README.txt').write_text(f'''SSH Relay Pro — {label} — {PLATFORM} x64
完整解压为单个文件夹，先运行 Start.cmd（Windows）或 ./Start.sh（Linux）。
已内置 Node、完整生产依赖、现有图形界面、默认公共中继配置、配置模板及第三方许可证。无需 npm install。
默认入口仅启动{label}；Open-UI 为现有的双角色图形管理界面，打开它会管理并启动近端和远端。
近端：Start 生成 MCP-CONFIG.json，加入 AI 客户端；让 AI 使用 ssh_connect 输入远端码。
远端：Start 显示本机新生成的一次性码，交给可信近端。已有授权自动重连。
Status 查看后台，Stop 停止本角色。退出界面/关闭控制台默认保留后台。
状态、私钥和授权由本机首次运行生成于用户目录 .ssh-relay-pro，不预置他人授权。
搬动程序目录前先停止后台；搬动后重新运行 Start，并更新 AI 中的 MCP-CONFIG.json 路径。
支持目标：Windows 10 1903+ x64；Ubuntu 24.04 x64（glibc 桌面）。Linux 图形界面需要系统桌面库和可用的 Chromium 沙箱；不会关闭系统保护。
CLI/MCP 不依赖桌面。数据库服务器及你的数据库属于目标电脑，不作为测试数据预装。
系统服务管理、sudo、定时调度继承本机已有权限；首次配对、自启动授权需本人操作。
不含 AI 模型、AI 客户端账号、数据库密码或私钥；MCP 包提供工具，调用它的 AI 客户端由你选择。
具体实测范围见仓库交付报告；Windows Server 验证不等同 Windows 10 本机验证。
''', encoding='utf-8')
    inventory = {str(p.relative_to(folder)): digest(p) for p in sorted(folder.rglob('*')) if p.is_file() and not p.is_symlink()}
    (folder / 'FILES-SHA256.json').write_text(json.dumps(inventory, indent=2) + '\n')
    if PLATFORM == 'windows':
        archive = OUT / (name + '.zip')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in sorted(folder.rglob('*')): z.write(p, str(Path(name) / p.relative_to(folder)))
    else:
        archive = OUT / (name + '.tar.gz')
        with tarfile.open(archive, 'w:gz', compresslevel=6) as t: t.add(folder, arcname=name)
    print(json.dumps({'file': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest(archive)}), flush=True)
