#!/usr/bin/env python3
"""Fast copy-only unified package, using pinned Electron and production dependencies."""
import argparse,hashlib,json,os,shutil,subprocess,tarfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--platform',choices=['linux','win32'],required=True);parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
 pins=json.loads((ROOT/'assets/pro-runtime-inputs.json').read_text());runtime=next(p for p in pins['electron']['files'] if p['platform']==args.platform)
 source=args.cache/runtime['file']
 if digest(source)!=runtime['sha256']:raise RuntimeError('Electron checksum mismatch')
 args.out.mkdir(parents=True,exist_ok=True);name='SSHRelayPro-5.3-'+args.platform+'-x64';folder=args.out/name
 if folder.exists():shutil.rmtree(folder)
 folder.mkdir()
 with zipfile.ZipFile(source) as z:
  z.extractall(folder)
  for entry in z.infolist():
   if (entry.external_attr>>16)&0o111:(folder/entry.filename).chmod(0o755)
 binary=folder/('SSHRelayPro.exe' if args.platform=='win32' else 'ssh-relay-pro')
 (folder/('electron.exe' if args.platform=='win32' else 'electron')).rename(binary)
 (folder/'resources/default_app.asar').unlink(missing_ok=True)
 app=folder/'resources/app';app.mkdir(parents=True)
 for directory in ['src','desktop','assets','launchers','profiles']:
  if (ROOT/directory).exists():shutil.copytree(ROOT/directory,app/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 for file in ['package.json','package-lock.json']:shutil.copy2(ROOT/file,app/file)
 listing=subprocess.run(['npm.cmd' if os.name=='nt' else 'npm','ls','--omit=dev','--all','--parseable'],cwd=ROOT,capture_output=True,text=True,check=True,shell=os.name=='nt')
 modules=set()
 for line in listing.stdout.splitlines():
  try:parts=Path(line).resolve().relative_to(ROOT/'node_modules').parts
  except ValueError:continue
  if parts:modules.add(str(Path(*parts[:2] if parts[0].startswith('@') else parts[:1])))
 for module in sorted(modules):shutil.copytree(ROOT/'node_modules'/module,app/'node_modules'/module,dirs_exist_ok=True,ignore=shutil.ignore_patterns('test','tests','__tests__','.github','benchmarks','examples'))
 if args.platform=='win32':
  winsw=args.cache/pins['winsw']['file']
  if digest(winsw)!=pins['winsw']['sha256']:raise RuntimeError('Service host checksum mismatch')
  (app/'vendor').mkdir();shutil.copy2(winsw,app/'vendor/WinSW-x64.exe');shutil.copy2(args.cache/'WinSW-LICENSE',app/'vendor/LICENSE.WinSW')
  for filename in ['Start.cmd','Restart.cmd']:
   (folder/filename).write_bytes(b'@echo off\r\nsetlocal DisableDelayedExpansion\r\nset ELECTRON_RUN_AS_NODE=\r\nstart "" "%~dp0SSHRelayPro.exe" --no-shortcuts %*\r\n')
  for filename,script in [('MCP.cmd','src\\mcp.cjs'),('CLI.cmd','src\\pro\\cli.cjs')]:
   (folder/filename).write_bytes(('@echo off\r\nsetlocal DisableDelayedExpansion\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0SSHRelayPro.exe" "%~dp0resources\\app\\'+script+'" %*\r\n').encode())
 else:
  for filename in ['Start.sh','Restart.sh']:
   (folder/filename).write_text('#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nunset ELECTRON_RUN_AS_NODE\nexec "$ROOT/ssh-relay-pro" --no-shortcuts "$@"\n');(folder/filename).chmod(0o755)
  for filename,script in [('MCP.sh','src/mcp.cjs'),('CLI.sh','src/pro/cli.cjs')]:
   (folder/filename).write_text('#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport ELECTRON_RUN_AS_NODE=1\nexec "$ROOT/ssh-relay-pro" "$ROOT/resources/app/'+script+'" "$@"\n');(folder/filename).chmod(0o755)
 mcp={'mcpServers':{'ssh-relay':{'command':str(binary.resolve()),'args':[str((app/'src/mcp.cjs').resolve())],'env':{'ELECTRON_RUN_AS_NODE':'1'}}}}
 # Paths must be generated at the final extraction location, not the build machine.
 (folder/'Generate-MCP.cjs').write_text('const fs=require("node:fs"),path=require("node:path");fs.writeFileSync(path.join(__dirname,"MCP-CONFIG.json"),JSON.stringify({mcpServers:{"ssh-relay":{command:path.join(__dirname,process.platform==="win32"?"SSHRelayPro.exe":"ssh-relay-pro"),args:[path.join(__dirname,"resources/app/src/mcp.cjs")],env:{ELECTRON_RUN_AS_NODE:"1"}}}},null,2)+"\\n");console.log("MCP-CONFIG.json generated");\n')
 if args.platform=='win32':
  (folder/'Generate-MCP.cmd').write_bytes(b'@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0SSHRelayPro.exe" "%~dp0Generate-MCP.cjs"\r\n')
 else:
  (folder/'Generate-MCP.sh').write_text('#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nELECTRON_RUN_AS_NODE=1 exec "$ROOT/ssh-relay-pro" "$ROOT/Generate-MCP.cjs"\n');(folder/'Generate-MCP.sh').chmod(0o755)
 (folder/'README.txt').write_text('SSH Relay Pro 5.3 — 统一版\n运行 Start.cmd（Windows）或 ./Start.sh（Linux）。无需安装 Node/npm。\n通过界面分别开启“连接其他电脑”和“允许其他电脑连接本机”，可同时开启，开关状态自动保存。\nWindows 首次点击“安装管理员后台”，确认一次 UAC。后台使用 SYSTEM 账户并立即启动，以后正常打开无需重复授权。安装后保持程序目录不变。\n首次将原用户后台切换为 SYSTEM，实际执行账户和默认目录会改变；已配对近端如提示账户变化，需显式重新配对确认新账户，不能绕过身份核验。\n一台可连接五台，五台可连接本机；断开某台只影响对应连接，授权记录保留。\n首次配对输入一次性配对码；以后保留设备身份和密钥，正常情况下自动连接。\nGenerate-MCP 生成当前路径的 MCP-CONFIG.json，将配置加入 AI 客户端。MCP 会复用后台。\nRestart/Start 均可一键重新打开窗口，已运行时聚焦现有窗口，不中断已有连接。\n退出界面保留后台。需要暂停时使用两项功能开关；不删除配对。\nLinux 开机服务按当前账户运行，不冒称 Windows 管理员服务；桌面库与可用的 Chromium 沙箱属于系统前提。\n未包含 AI 客户端、数据库服务器、数据库工具、用户密钥、配对码或私人状态。未改变已有执行/传输引擎。\n',encoding='utf8')
 source_hash={str(p.relative_to(app)):digest(p) for d in ['src','desktop','launchers'] for p in sorted((app/d).rglob('*')) if p.is_file()}
 manifest={'version':'5.3','roles':['near','far'],'platform':args.platform,'architecture':'x64','runtime':runtime,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sourceFilesSHA256':source_hash,'lockfileSHA256':digest(app/'package-lock.json'),'credentialsIncluded':False}
 (folder/'PACKAGE.json').write_text(json.dumps(manifest,indent=2)+'\n')
 if args.platform=='win32':
  archive=args.out/(name+'.zip')
  with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
   for p in sorted(folder.rglob('*')):
    if p.is_file():z.write(p,str(Path(name)/p.relative_to(folder)))
 else:
  archive=args.out/(name+'.tar.gz')
  with tarfile.open(archive,'w:gz',compresslevel=1) as t:t.add(folder,arcname=name)
 (args.out/(archive.name+'.sha256')).write_text(digest(archive)+'  '+archive.name+'\n')
 print(json.dumps({'folder':str(folder),'archive':str(archive),'sha256':digest(archive),'bytes':archive.stat().st_size}),flush=True)
if __name__=='__main__':main()
