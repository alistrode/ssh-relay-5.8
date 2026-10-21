#!/usr/bin/env python3
"""Self-contained GUI packages; no private state is ever copied."""
from pathlib import Path
import os,sys,subprocess,json,zipfile,tarfile,tempfile,shutil,hashlib,stat,io,lzma,base64
ROOT=Path(__file__).resolve().parents[1];CACHE=Path(sys.argv[1]if len(sys.argv)>1 else'/workspace/relay-pro-tools');OUT=ROOT/'deliverables/pro';OUT.mkdir(parents=True,exist_ok=True)
INPUTS=json.loads((ROOT/'assets/pro-runtime-inputs.json').read_text());VERSION=INPUTS['electron']['version']
def tarxz(folder,target):
 # Standard XZ x86 BCJ filter improves PE/ELF code compression without omitting runtime files.
 with lzma.open(target,'wb',filters=[{'id':lzma.FILTER_X86},{'id':lzma.FILTER_LZMA2,'preset':9}])as compressed:
  with tarfile.open(fileobj=compressed,mode='w|')as archive:
   for p in sorted(folder.rglob('*')):
    arc=str(Path('SSHRelayPro')/p.relative_to(folder));archive.add(p,arcname=arc,recursive=False)
 print(target.name,target.stat().st_size,flush=True)
def production():
 result=subprocess.run(['npm','ls','--omit=dev','--all','--parseable'],cwd=ROOT,capture_output=True,text=True);paths=set()
 if result.returncode:raise RuntimeError('Production dependency tree is incomplete; run npm ci --ignore-scripts')
 for line in result.stdout.splitlines():
  p=Path(line)
  try:relative=p.relative_to(ROOT/'node_modules')
  except ValueError:continue
  if relative.parts:paths.add(relative.parts[:2]if relative.parts[0].startswith('@')else relative.parts[:1])
 return sorted({str(Path(*p))for p in paths})
def appFiles(app):
 # Removed documentation and skills are not runtime requirements.
 for name in ['src','desktop','assets','launchers']:
  if not (ROOT/name).is_dir():raise RuntimeError('Required application source directory missing: '+name)
  shutil.copytree(ROOT/name,app/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'),dirs_exist_ok=True)
 for name in ['profiles','docs','examples']:
  if (ROOT/name).is_dir():shutil.copytree(ROOT/name,app/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'),dirs_exist_ok=True)
 shutil.copyfile(ROOT/'package.json',app/'package.json')
 for name in ['LICENSE.mcp-ssh-manager','README.md','AGENTS.md']:
  if (ROOT/name).is_file():shutil.copyfile(ROOT/name,app/name)
 if not (ROOT/'LICENSE.mcp-ssh-manager').is_file():
  raise RuntimeError('Original MCP license notice is absent; restore from the documented source before distributing a runtime package')
 for name in production():
  source=ROOT/'node_modules'/name
  if source.exists():shutil.copytree(source,app/'node_modules'/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('test','tests','__tests__','examples','bench','benchmarks','.github'))

def main():
 assert hashlib.sha256((CACHE/INPUTS['winsw']['file']).read_bytes()).hexdigest()==INPUTS['winsw']['sha256']
 for item in INPUTS['electron']['files']:
  if os.environ.get('PRO_BUILD_PLATFORM')and item['platform']!=os.environ['PRO_BUILD_PLATFORM']:continue
  assert hashlib.sha256((CACHE/item['file']).read_bytes()).hexdigest()==item['sha256']
  platform=item['platform']
  with tempfile.TemporaryDirectory(prefix='relay-pro-build-')as temp:
   folder=Path(temp)/'SSHRelayPro';folder.mkdir()
   with zipfile.ZipFile(CACHE/item['file'])as z:
    z.extractall(folder)
    for i in z.infolist():
     if(i.external_attr>>16)&0o111:os.chmod(folder/i.filename,0o755)
   default=folder/'resources/default_app.asar'
   if default.exists():default.unlink()
   # Unused language packs are removed; retain English/Chinese and all runtime libraries.
   locales=folder/'locales'
   if locales.exists():
    for p in locales.iterdir():
     if p.name not in ['en-US.pak','zh-CN.pak','zh-TW.pak']:p.unlink()
   executable='SSHRelayPro.exe'if platform=='win32'else'ssh-relay-pro';(folder/('electron.exe'if platform=='win32'else'electron')).rename(folder/executable)
   app=folder/'resources/app';app.mkdir(parents=True);appFiles(app)
   if platform=='win32':
    vendor=app/'vendor';vendor.mkdir();shutil.copyfile(CACHE/INPUTS['winsw']['file'],vendor/'WinSW-x64.exe');shutil.copyfile(CACHE/'WinSW-LICENSE',vendor/'LICENSE.WinSW')
    for name,script in {'relay-cli.cmd':'src\\pro\\cli.cjs','MCP.cmd':'src\\mcp.cjs'}.items():
     (folder/name).write_text('@echo off\nsetlocal DisableDelayedExpansion\nset ELECTRON_RUN_AS_NODE=1\n"%~dp0SSHRelayPro.exe" "%~dp0resources\\app\\'+script+'" %*\n',newline='\r\n')
    for name,export in [('Start.cmd',False),('Diagnostics.cmd',True)]:
     command="& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $env:SSH_RELAY_LAUNCH_ROOT 'resources\\app\\launchers\\Start-Pro.ps1'))))" + (' -ExportOnly' if export else '')
     encoded=base64.b64encode(command.encode('utf-16le')).decode()
     (folder/name).write_text('@echo off\nsetlocal DisableDelayedExpansion\nset "SSH_RELAY_LAUNCH_ROOT=%~dp0"\npowershell.exe -NoProfile -NonInteractive -EncodedCommand '+encoded+'\nif errorlevel 1 pause\n',newline='\r\n')
   else:
    for name,script in {'relay-cli':'src/pro/cli.cjs','mcp':'src/mcp.cjs'}.items():
     p=folder/name;p.write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1\nELECTRON_RUN_AS_NODE=1 exec "$ROOT/ssh-relay-pro" "$ROOT/resources/app/'+script+'" "$@"\n');p.chmod(0o755)
   (app/'BUILD-PRO.json').write_text(json.dumps({'applicationVersion':json.loads((ROOT/'package.json').read_text())['version'],'platform':platform,'runtime':item,'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for folder in ['src','desktop','launchers'] for p in sorted((ROOT/folder).rglob('*'))if p.suffix in ['.js','.cjs','.ps1']}},indent=2)+'\n')
   (folder/'README.txt').write_text('SSH Relay Pro 2.0\n首次打开后，远端点击生成配对码，近端输入后会记住设备并自动连接。\n已内置图形界面和运行环境，无需安装 Node/npm。关闭窗口保留后台，托盘可重新打开。\n自启动开关分为登录启动与开机后台服务；后者需首次管理员授权。Windows SYSTEM 服务的权限和目录不同于桌面账户，界面会明确提示。\n设备授权与日志保存在用户目录 .ssh-relay-pro，不在程序目录。请勿公开私钥、配对码或原始日志。\n本升级版使用现有公共 MQTT 中继，无需购买或部署服务器；不替换旧版通道。\nLinux 推荐安装 DEB，或在支持用户命名空间沙箱的桌面中解压 TAR 后双击 ssh-relay-pro（原生程序）；不更改系统沙箱设置，不把 .desktop 当作初次双击入口。\nWindows 解压下载 ZIP 后双击 Setup.cmd，使用系统自带 tar.exe 解包，然后启动原生界面；需要 Windows 10 1803+ / Windows 11 x64。\n')
   for p in sorted(folder.rglob('*')):
    if p.is_dir():p.chmod(0o755)
    elif not p.is_symlink():p.chmod(0o755 if os.stat(p).st_mode&0o111 else 0o644)
   folder.chmod(0o755)
   archive=OUT/('windows-pro-runtime.tar.xz'if platform=='win32'else'ssh-relay-pro-linux-x64.tar.xz');tarxz(folder,archive)
   if platform=='win32':
    setup=r'''@echo off
setlocal DisableDelayedExpansion
where tar.exe >nul 2>nul
if errorlevel 1 (
 echo Windows 10 1803 or newer is required for the built-in tar.exe.
 pause
 exit /b 1
)
echo Extracting the bundled application. No Node or npm installation is needed.
tar.exe -xf "%~dp0app.tar.xz" -C "%LOCALAPPDATA%"
if errorlevel 1 (
 echo Extraction failed. Quit any previous SSH Relay Pro version and retry.
 pause
 exit /b 1
)
call "%LOCALAPPDATA%\SSHRelayPro\Start.cmd"
'''
    with zipfile.ZipFile(OUT/'ssh-relay-pro-windows-x64.zip','w',zipfile.ZIP_STORED)as z:z.write(archive,'app.tar.xz');z.writestr('Setup.cmd',setup.replace('\n','\r\n'));z.writestr('README.txt',(folder/'README.txt').read_bytes())
    archive.unlink();print('Windows installer ZIP bytes',(OUT/'ssh-relay-pro-windows-x64.zip').stat().st_size,flush=True)
   else:
    deb=Path(temp)/'deb';target=deb/'opt/ssh-relay-pro';shutil.copytree(folder,target);control=deb/'DEBIAN';control.mkdir(parents=True);control.chmod(0o755);(control/'control').write_text('Package: ssh-relay-pro\nVersion: 2.0.1\nArchitecture: amd64\nMaintainer: Private Relay Project\nDepends: libc6 (>= 2.31), libgtk-3-0, libnss3, libxss1, libasound2 | libasound2t64, libgbm1, libx11-6, libxkbcommon0\nDescription: Paired public SSH relay with persistent reconnect and tray UI\n');sandbox=target/'chrome-sandbox'
    if sandbox.exists():sandbox.chmod(0o4755)
    menu=deb/'usr/share/applications';menu.mkdir(parents=True);(menu/'ssh-relay-pro.desktop').write_text('[Desktop Entry]\nType=Application\nName=SSH Relay Pro\nName[zh_CN]=SSH 远端 Pro\nExec=/opt/ssh-relay-pro/ssh-relay-pro\nIcon=/opt/ssh-relay-pro/resources/app/assets/relay.svg\nTerminal=false\nCategories=Network;\nStartupWMClass=ssh-relay-pro\n')
    for directory in [deb,*[p for p in deb.rglob('*')if p.is_dir()]]:directory.chmod(0o755)
    (control/'control').chmod(0o644);(menu/'ssh-relay-pro.desktop').chmod(0o644)
    subprocess.run(['dpkg-deb','--root-owner-group','--threads-max=1','-Zxz','-z9','--build',str(deb),str(OUT/'ssh-relay-pro-linux-amd64.deb')],check=True)
 (OUT/'RUNTIME-PROVENANCE.json').write_text(json.dumps(INPUTS,indent=2)+'\n')
 for p in OUT.iterdir():
  if p.suffix in ['.zip','.deb']or p.name.endswith('.tar.xz'):
   if p.stat().st_size>=100*1024*1024:raise RuntimeError('Package exceeds GitHub single-file limit: '+p.name)
 (OUT/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n'for p in sorted(OUT.iterdir())if p.suffix in ['.zip','.deb']or p.name.endswith('.tar.xz')))
if __name__=='__main__':main()
