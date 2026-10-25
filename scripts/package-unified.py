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
 args.out.mkdir(parents=True,exist_ok=True);name='SSHRelayPro-5.5-'+args.platform+'-x64';folder=args.out/name
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
 for directory in ['src','desktop','assets','launchers','profiles','docs','.agents']:
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
 (folder/'README.txt').write_text('SSH Relay Pro 5.5\n运行 Start.cmd（Windows）或 ./Start.sh（Linux）。无需安装 Node/npm。\n客户端与后台一起运行，不提供独立后台服务。关闭窗口收起到托盘，异常退出自动恢复，只有托盘退出会清理全部所属进程。\n主动连接与被连接各最多 20 台。设备显示系统版本，支持全选、框选及批量连接、断开、取消授权。\n复制配对码和所有操作按钮均显示处理结果。\n升级会移除同一配置目录的旧独立服务；Windows 使用当前客户端账户执行，所需权限由客户端启动令牌决定。\nGenerate-MCP 生成当前路径的 MCP 配置；MCP 与 CLI 自动复用或打开完整客户端，不启动独立后台。\n首次配对使用远端配对码，之后沿用已保存授权。未内置用户密钥、私人状态或 AI 客户端。\n',encoding='utf8')
 source_hash={str(p.relative_to(app)):digest(p) for d in ['src','desktop','launchers'] for p in sorted((app/d).rglob('*')) if p.is_file()}
 manifest={'version':'5.5','roles':['near','far'],'platform':args.platform,'architecture':'x64','runtime':runtime,'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sourceFilesSHA256':source_hash,'lockfileSHA256':digest(app/'package-lock.json'),'credentialsIncluded':False}
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
