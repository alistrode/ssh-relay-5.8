#!/usr/bin/env python3
"""Package official checksum-verified Node runtimes, launchers and existing relay bundles."""
from pathlib import Path
import hashlib,json,stat,struct,subprocess,tarfile,zipfile,sys,tempfile,io
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'deliverables';CACHE=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'.node-runtime-cache'
def link(relative,icon):
 # MS-SHLLINK: Unicode RelativePath/WorkingDir/IconLocation, no absolute host paths.
 h=struct.pack('<I',76)+bytes.fromhex('0114020000000000c000000000000046')
 h+=struct.pack('<IIQQQIiIHHII',0xD8,0x20,0,0,0,0,0,1,0,0,0,0)
 assert len(h)==76
 for s in [relative,'.',icon]:h+=struct.pack('<H',len(s))+s.encode('utf-16le')
 return h+struct.pack('<I',0)
def quote(s):return ('"'+''.join('\\'+c if c in '\\"`$'else c for c in s)+'"').replace('\\','\\\\')
def write(target,files):
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
  for name,data in sorted(files.items()):
   i=zipfile.ZipInfo(name);i.create_system=3;i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=((stat.S_IFREG|(0o755 if name.endswith(('.sh','.desktop'))or name in ['runtime/node','SSH-Remote']else 0o644))<<16);z.writestr(i,data)
def main():
 meta=json.loads((ROOT/'assets/node-runtime-inputs.json').read_text());version=meta['version'];CACHE.mkdir(parents=True,exist_ok=True)
 for item in meta['archives']:
  dest=CACHE/item['file']
  if not dest.exists():
   import urllib.request
   with urllib.request.urlopen(f"https://nodejs.org/dist/{version}/{item['file']}",timeout=180)as response:dest.write_bytes(response.read())
 for item in meta['archives']:assert hashlib.sha256((CACHE/item['file']).read_bytes()).hexdigest()==item['sha256']
 with zipfile.ZipFile(OUT/'near-far-minimal.zip')as z:base={n:z.read(n)for n in z.namelist()if n not in ['README.md','START-REMOTE.cmd','START-REMOTE.sh','BUILD.json']}
 for platform in ['windows','linux']:
  files=base.copy()
  for p in(ROOT/'assets').glob('*'):files[str(p.relative_to(ROOT))]=p.read_bytes()
  files['launchers/desktop.cjs']=(ROOT/'launchers/desktop.cjs').read_bytes()
  suffix='cmd'if platform=='windows'else'sh';files['START-REMOTE.'+suffix]=(ROOT/f'launchers/START-REMOTE.{suffix}').read_bytes()
  if platform=='windows':
   with zipfile.ZipFile(CACHE/f'node-{version}-win-x64.zip')as z:
    prefix=f'node-{version}-win-x64/'
    for name in ['node.exe','LICENSE']:files['runtime/'+name]=z.read(prefix+name)
   files['SSH-Remote.lnk']=link('START-REMOTE.cmd','assets\\relay.ico')
   start='双击 SSH-Remote.lnk（终端图标）或 START-REMOTE.cmd。首次启动自动创建桌面上的 SSH Remote 图标。Windows 10/11 x64。'
  else:
   with tarfile.open(CACHE/f'node-{version}-linux-x64.tar.xz')as t:
    prefix=f'node-{version}-linux-x64/'
    for src,dest in [('bin/node','runtime/node'),('LICENSE','runtime/LICENSE')]:files[dest]=t.extractfile(prefix+src).read()
   with tempfile.TemporaryDirectory(prefix='relay-native-')as temp:
    executable=Path(temp)/'SSH-Remote'
    subprocess.run(['gcc','-Os','-static','-s','-Wall','-Wextra',str(ROOT/'launchers/linux-launcher.c'),'-o',str(executable)],check=True)
    files['SSH-Remote']=executable.read_bytes()
   files['SSH-Remote.desktop']=('[Desktop Entry]\nVersion=1.0\nType=Application\nName=Start SSH Remote\nName[zh_CN]=启动 SSH 远端\nExec=/bin/sh -c '+quote('exec /bin/sh "$(dirname "$1")/START-REMOTE.sh"')+' launcher %k\nIcon=utilities-terminal\nTerminal=true\nCategories=Network;\nStartupNotify=false\n').encode()
   files.pop('SSH-Remote.desktop',None)
   start='优先下载并解压 remote-linux-x64.tar.gz，双击 SSH-Remote（无扩展名，原生 ELF 程序），不要再双击 .desktop 或 .sh。首次启动会创建桌面上的原生启动链接 SSH-Remote，避免 .desktop 被当作文本打开。如果文件系统禁止执行，需在文件属性中允许执行；这不是文件打开方式的问题。Linux x64，glibc 2.28+；不支持 Alpine/musl。'
  files['README.txt']=(f'SSH 远端 — {platform} x64\n\n{start}\n\n已内置官方 Node.js {version}，不用安装 Node 或 npm，也不需要管理员权限安装。完整解压后再启动，不要在压缩包内直接运行；保留整个解压目录，桌面图标会引用这里。\n\n启动后保持窗口开启，把完整私密连接块交给可信 AI。两端都更新并核对协议 2。远端继承启动账户权限；管理员权限需求请使用你已获授权的管理员终端启动。data/ 首次运行时生成，内含私钥，不要上传。\n\n这是近远端运行包，完整 MCP 工程与提示词在 source.zip。此包为构建产物，不冒称原始源码。运行时来自 nodejs.org，下载文件与官方 SHASUMS256.txt 校验一致。Windows 与 Linux 分开下载。\n').encode()
  files['BUILD.json']=(json.dumps({'applicationBaseCommit':'48538322d1b4204802b9500f1b9255c2ca31e2f0','nodeVersion':version,'platform':platform,'architecture':'x64','runtimeIncluded':True,'runtimeArchive':next(x for x in meta['archives']if ('win-x64'if platform=='windows'else'linux-x64')in x['file']),'runtimeOrigin':f'https://nodejs.org/dist/{version}/','includesCredentials':False},indent=2)+'\n').encode()
  target=OUT/f'remote-{platform}-x64.zip';write(target,files);print(target.name,target.stat().st_size,flush=True)
  if platform=='linux':
   tarpath=OUT/'remote-linux-x64.tar.gz'
   with tarfile.open(tarpath,'w:gz',compresslevel=6)as archive:
    for name,data in sorted(files.items()):
     entry=tarfile.TarInfo('SSH-Remote-Linux/'+name);entry.size=len(data);entry.mode=0o755 if name in ['runtime/node','SSH-Remote']or name.endswith(('.sh','.desktop'))else 0o644;archive.addfile(entry,io.BytesIO(data))
   print(tarpath.name,tarpath.stat().st_size,flush=True)
   patch=OUT/'linux-launcher-fix.tar.gz'
   selected={name:files[name]for name in ['SSH-Remote','START-REMOTE.sh','launchers/desktop.cjs','assets/relay.svg']}
   selected['APPLY-FIX.txt']='解压到旧版 Linux 远端所在文件夹，覆盖同名文件。然后双击 SSH-Remote（无扩展名），不要再点旧的 .desktop。补丁不含 Node，适用于已内置 runtime/node 的上一版运行包。原有 data/ 不修改、不包含于补丁。\n'.encode()
   with tarfile.open(patch,'w:gz',compresslevel=6)as archive:
    for name,data in sorted(selected.items()):
     entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o755 if name in ['SSH-Remote','START-REMOTE.sh']else 0o644;archive.addfile(entry,io.BytesIO(data))
   print(patch.name,patch.stat().st_size,flush=True)
 # Full source, without nested runtime archives.
 names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT,text=True).split('\0');write(OUT/'source.zip',{n:(ROOT/n).read_bytes()for n in names if n and not n.startswith('deliverables/')and(ROOT/n).is_file()})
 (OUT/'NODE-RUNTIME-PROVENANCE.json').write_text(json.dumps(meta,indent=2)+'\n')
 (OUT/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n'for p in sorted(list(OUT.glob('*.zip'))+list(OUT.glob('*.tar.gz')))))
if __name__=='__main__':main()
