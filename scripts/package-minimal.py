#!/usr/bin/env python3
"""Build credential-free near/far runtime and a separate source archive."""
import hashlib,json,subprocess,tempfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables'
def run(*args):return subprocess.check_output(args,cwd=ROOT,text=True).strip()
def write_zip(target,items):
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9)as z:
  for name,data in sorted(items.items()):z.writestr(name,data)
def main():
 OUT.mkdir(exist_ok=True)
 base=run('git','rev-parse','HEAD')
 with tempfile.TemporaryDirectory(prefix='relay-package-')as temp:
  stage=Path(temp)
  subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),'src/start.cjs','src/near.cjs','src/remote.cjs','--bundle','--platform=node','--target=node22','--minify',f'--outdir={stage}/src','--out-extension:.js=.cjs','--legal-comments=external','--external:cpu-features','--external:./crypto/build/Release/sshcrypto.node'],cwd=ROOT,check=True)
  items={str(p.relative_to(stage)):p.read_bytes()for p in stage.rglob('*')if p.is_file()}
  items['START-REMOTE.cmd']=(ROOT/'START-REMOTE.cmd').read_bytes()
  items['START-REMOTE.sh']=b'#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec node src/start.cjs\n'
  items['README.md']=('''# Minimal public near/far runtime\n\nRequires existing Node.js 22+; no npm install needed. Windows: run START-REMOTE.cmd. Linux: run sh START-REMOTE.sh. Keep the window open. Give the complete PRIVATE connection block only to your trusted AI. Update BOTH near and far and verify relay_protocol=2. This archive contains generated runtime bundles, not original source.\n\nAI near-end: use the bundled .agents/skills/connect-*/scripts/connect.py with --platform linux or win10 and --info-file /private/incoming.txt. Python 3.10+ and OpenSSH are required. The helper uses this archive's src/near.cjs; skip npm ci for this prebundled archive. Verify actual hostname/account and pinned SSH fingerprint. Do not upload data/, connection blocks, keys or logs.\n\nMCP tools, profiles, prompts and full application source are in source.zip; unpack it and use npm ci --ignore-scripts, then follow docs/MCP-MANUAL.md. This minimal runtime supplies the current near/far connection only.\n\nPrivate state is generated locally in data/ on first launch. Never copy old runtime data into a public location. Diagnostic metadata: data/far-events.jsonl and the private near state directory. Node.js itself is not bundled.\n''').encode()
  for p in (ROOT/'.agents/skills').rglob('*'):
   if p.is_file()and p.suffix in ['.md','.py']:items[str(p.relative_to(ROOT))]=p.read_bytes()
  for name in ['docs/PERMISSIONS.md','docs/troubleshooting.md','LICENSE.mcp-ssh-manager']:
   items[name]=(ROOT/name).read_bytes()
  for p in (ROOT/'node_modules').rglob('*'):
   if p.is_file()and p.name.upper().startswith(('LICENSE','NOTICE','COPYING')):items['licenses/'+str(p.relative_to(ROOT/'node_modules'))]=p.read_bytes()
  items['BUILD.json']=(json.dumps({'applicationBaseCommit':base,'nodeRuntimeRequired':'>=22','generatedRuntime':True,'includesCredentials':False},indent=2)+'\n').encode()
  write_zip(OUT/'near-far-minimal.zip',items)
 names=run('git','ls-files','-z').split('\0')
 source={n:(ROOT/n).read_bytes()for n in names if n and not n.startswith('deliverables/')and(ROOT/n).is_file()}
 write_zip(OUT/'source.zip',source)
 sums=[]
 for name in ['near-far-minimal.zip','source.zip']:
  p=OUT/name;sums.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+name);print(name,p.stat().st_size,'bytes')
 (OUT/'SHA256SUMS').write_text('\n'.join(sums)+'\n')
if __name__=='__main__':main()
