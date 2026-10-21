#!/usr/bin/env python3
"""Verify release archives contain the measured application and full pinned runtime."""
from pathlib import Path,PurePosixPath
import hashlib,io,json,subprocess,tarfile,zipfile

repo=Path(__file__).resolve().parents[1];out=repo/'deliverables/pro'
expected={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest()for folder in ['src','desktop','launchers'] for p in sorted((repo/folder).rglob('*'))if p.suffix in ['.js','.cjs','.ps1']}
version=json.loads((repo/'package.json').read_text())['version'];results=[]
def inspect(archive,prefix,platform):
 members={x.name:x for x in archive.getmembers()}
 assert all(not PurePosixPath(x).is_absolute() and '..'not in PurePosixPath(x).parts for x in members)
 def payload(name):
  member=members[prefix+name];assert member.isfile(),name
  return archive.extractfile(member).read()
 for name,digest in expected.items():assert hashlib.sha256(payload('resources/app/'+name)).hexdigest()==digest,name
 manifest=json.loads(payload('resources/app/BUILD-PRO.json'));assert manifest['sourceSha256']==expected
 assert manifest['applicationVersion']==version
 for name in ['SSH-RELAY-END-TO-END-DESIGN.md','SSH-RELAY-DEVELOPMENT-HANDOFF.md','MCP-SOURCE-PROVENANCE.json']:payload('resources/app/docs/'+name)
 payload('resources/app/assets/licenses/mcp-ssh-manager.LICENSE')
 assert payload('resources/app/package.json')==(repo/'package.json').read_bytes()
 for name in ['ssh2','mqtt','@serenity-kit/opaque','@modelcontextprotocol/sdk']:
  payload('resources/app/node_modules/'+name+'/package.json')
 payload('LICENSE');payload('LICENSES.chromium.html')
 # Current connection instructions are embedded in MCP prompts; removed skills are not package requirements.
 payload('resources/app/src/mcp/prompts.js')
 exe=payload('SSHRelayPro.exe'if platform=='win32'else'ssh-relay-pro')
 assert exe[:2]==(b'MZ'if platform=='win32'else b'\x7fE')
 if platform=='win32':
  inputs=json.loads((repo/'assets/pro-runtime-inputs.json').read_text());assert hashlib.sha256(payload('resources/app/vendor/WinSW-x64.exe')).hexdigest()==inputs['winsw']['sha256'];payload('relay-cli.cmd');payload('MCP.cmd');payload('Start.cmd');payload('Diagnostics.cmd');payload('resources/app/launchers/Start-Pro.ps1')
  for name in ['icudtl.dat','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','ffmpeg.dll','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','vk_swiftshader.dll','vulkan-1.dll']:payload(name)
 else:
  assert members[prefix+'ssh-relay-pro'].mode&0o111;payload('relay-cli');payload('mcp');payload('libffmpeg.so');payload('libvk_swiftshader.so');payload('libvulkan.so.1')
 forbidden={'connection.json','connection-private.json','client_key','host_key','agent-runtime.json','guardian-runtime.json'}
 assert not any(PurePosixPath(n).name in forbidden for n in members)
 return {'platform':platform,'archiveMembers':len(members),'measuredApplicationFiles':len(expected),'currentDesignAndHandoffIncluded':True,'productionDependenciesIncluded':True}
with tarfile.open(out/'ssh-relay-pro-linux-x64.tar.xz','r:xz')as t:
 results.append({'file':'ssh-relay-pro-linux-x64.tar.xz',**inspect(t,'SSHRelayPro/','linux')})
with zipfile.ZipFile(out/'ssh-relay-pro-windows-x64.zip')as z:
 assert z.testzip()is None
 assert set(z.namelist())=={'app.tar.xz','Setup.cmd','README.txt'}
 setup=z.read('Setup.cmd');assert b'tar.exe -xf'in setup and b'LOCALAPPDATA'in setup
 with tarfile.open(fileobj=io.BytesIO(z.read('app.tar.xz')),mode='r:xz')as t:
  results.append({'file':'ssh-relay-pro-windows-x64.zip',**inspect(t,'SSHRelayPro/','win32')})
p=subprocess.Popen(['dpkg-deb','--fsys-tarfile',str(out/'ssh-relay-pro-linux-amd64.deb')],stdout=subprocess.PIPE)
with tarfile.open(fileobj=p.stdout,mode='r|')as t:
 # Deb contains the same Linux app, with package-manager owned sandbox permissions.
 seen=set();verified=0
 for member in t:
  seen.add(member.name)
  assert member.uid==member.gid==0
  if member.name=='./opt/ssh-relay-pro/chrome-sandbox':assert member.mode==0o4755
  if member.name=='./usr/share/applications/ssh-relay-pro.desktop':assert member.mode==0o644
  prefix='./opt/ssh-relay-pro/resources/app/'
  relative=member.name.removeprefix(prefix)
  if member.name.startswith(prefix)and relative in expected:
   assert hashlib.sha256(t.extractfile(member).read()).hexdigest()==expected[relative];verified+=1
assert p.wait()==0 and verified==len(expected)
assert './usr/share/applications/ssh-relay-pro.desktop'in seen
results.append({'file':'ssh-relay-pro-linux-amd64.deb','measuredApplicationFiles':verified,'rootOwnershipAndSandboxModeVerified':True})
for row in results:
 path=out/row['file'];row['bytes']=path.stat().st_size;assert row['bytes']<100*1024*1024
 row['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
(out/'PACKAGE-CHECKS.json').write_text(json.dumps({'passed':True,'scope':'archive integrity and self-contained inputs; native acceptance is recorded separately','applicationVersion':version,'packages':results},indent=2)+'\n')
print(json.dumps({'passed':True,'scope':'archive integrity and self-contained inputs; native acceptance is recorded separately','applicationVersion':version,'packages':results}))
