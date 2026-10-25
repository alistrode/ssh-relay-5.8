#!/usr/bin/env python3
"""Build the Linux desktop + headless distribution from pinned runtime inputs."""
import hashlib, json, os, shutil, subprocess, sys, tarfile, zipfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
cache = Path(sys.argv[1]).resolve()
stage = Path(sys.argv[2]).resolve() / 'SSHRelayPro-5.3-linux-x64'
if stage.exists():
    raise SystemExit('Staging directory already exists')
inputs = json.loads((root / 'assets/pro-runtime-inputs.json').read_text())
electron = next(x for x in inputs['electron']['files'] if x['platform'] == 'linux')
node_file = 'node-v24.19.0-linux-x64.tar.xz'
node_sha = next(line.split()[0] for line in (cache/'SHASUMS256.txt').read_text().splitlines() if line.split()[-1] == node_file)
for filename, expected in [(electron['file'], electron['sha256']), (node_file, node_sha)]:
    assert hashlib.sha256((cache/filename).read_bytes()).hexdigest() == expected, filename
stage.mkdir(parents=True)
with zipfile.ZipFile(cache/electron['file']) as archive:
    archive.extractall(stage)
    for item in archive.infolist():
        if (item.external_attr >> 16) & 0o111:
            (stage/item.filename).chmod(0o755)
(stage/'electron').rename(stage/'ssh-relay-pro')
(stage/'resources/default_app.asar').unlink(missing_ok=True)
app = stage/'resources/app'
app.mkdir(parents=True)
for folder in ['src', 'desktop', 'assets', 'launchers', 'docs', 'profiles', 'examples', '.agents', 'node_modules']:
    shutil.copytree(root/folder, app/folder, symlinks=True)
for filename in ['package.json', 'package-lock.json']:
    shutil.copy2(root/filename, app/filename)
with tarfile.open(cache/node_file) as archive:
    prefix = 'node-v24.19.0-linux-x64/'
    for source, target in [('bin/node', 'runtime/node'), ('LICENSE', 'runtime/LICENSE'), ('README.md', 'runtime/README.md')]:
        dest = stage/target
        dest.parent.mkdir(exist_ok=True)
        dest.write_bytes(archive.extractfile(prefix+source).read())
(stage/'runtime/node').chmod(0o755)
for name, entry in [('CLI.sh', 'src/pro/cli.cjs'), ('MCP.sh', 'src/mcp.cjs')]:
    target = stage/name
    target.write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexec "$ROOT/runtime/node" "$ROOT/resources/app/'+entry+'" "$@"\n')
    target.chmod(0o755)
(stage/'Start.sh').write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexec "$ROOT/CLI.sh" start "$@"\n')
(stage/'Start-Desktop.sh').write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nexec "$ROOT/ssh-relay-pro" "$@"\n')
for name in ['Start.sh', 'Start-Desktop.sh']:
    (stage/name).chmod(0o755)
manifest = {'release':'5.3', 'platform':'linux-x64', 'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(), 'node':{'version':'24.19.0','archive':node_file,'sha256':node_sha}, 'electron':electron, 'files':{str(p.relative_to(app)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((app/'src').rglob('*')) if p.is_file()}}
(stage/'BUILD.json').write_text(json.dumps(manifest,indent=2)+'\n')
(stage/'README.md').write_text('''# SSH Relay Pro 5.3 Linux x64

内置 Node.js、Electron、生产依赖、Agent、CLI 和 MCP；不需要安装 Node/npm。
Linux x86_64，glibc 2.28+。云端无桌面可使用全部后台入口；桌面入口需要 GTK/NSS/音频等 Electron 系统库和可用的桌面会话。

```sh
./Start.sh
./CLI.sh devices
./CLI.sh connect --args-stdin
# 在标准输入提供 {"code":"配对码","waitMs":20000}
./CLI.sh status
./MCP.sh
# 有桌面时：
./Start-Desktop.sh
```

CLI 和 MCP 可用 --state-dir /绝对路径 指定同一个 near 状态目录。默认授权保存在 ~/.ssh-relay-pro/near；更新时保留该目录，后续使用已记住的设备，不要重复配对。
Start.sh 启动后台后返回；CLI.sh stop 显式停止对应后台。桌面程序应使用普通用户及正常系统沙箱运行。
本包不包含任何用户授权、私钥、配对码或日志。来源和运行时校验值见 BUILD.json。
''')
out = root/'packages/5.3/SSHRelayPro-5.3-linux-x64.tar.gz'
with tarfile.open(out,'w:gz',compresslevel=6) as archive:
    archive.add(stage,arcname=stage.name)
digest = hashlib.sha256(out.read_bytes()).hexdigest()
Path(str(out)+'.sha256').write_text(digest+'  '+out.name+'\n')
print(json.dumps({'archive':str(out),'sha256':digest,'bytes':out.stat().st_size,'stage':str(stage)}))
