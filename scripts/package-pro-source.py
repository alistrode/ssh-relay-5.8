#!/usr/bin/env python3
"""Archive indexed project files only; never include runtime/private directories."""
from pathlib import Path
import argparse,hashlib,json,subprocess,zipfile

repo=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('output',nargs='?',default=str(repo/'deliverables/pro/source.zip'))
parser.add_argument('--index',type=Path,help='Explicit source index for an API-materialized checkout without .git')
args=parser.parse_args()
output=Path(args.output).resolve()
output.parent.mkdir(parents=True,exist_ok=True)
if args.index:
    index=json.loads(args.index.read_text())
    commit=index['sourceCommit'];branch=index['branch']
    if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit):raise RuntimeError('Source index requires a full commit SHA')
    entries=index['paths']
else:
    entries=[p.decode() for p in subprocess.check_output(['git','ls-files','-z'],cwd=repo).split(b'\0') if p]
    branch=subprocess.check_output(['git','branch','--show-current'],cwd=repo,text=True).strip()
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
forbidden={'node_modules','data','dist','.runtime-cache','.ssh-relay-pro','__pycache__','.git'}
private={'agent-runtime.json','guardian-runtime.json','connection.json','client_key','host_key'}
paths=[]
for name in entries:
    p=Path(name)
    if p.is_absolute() or '..' in p.parts or forbidden.intersection(p.parts) or p.name in private:
        raise RuntimeError('Private or invalid source index entry')
    if p.parts and p.parts[0]=='deliverables':continue
    paths.append(p)
if Path('src/pro/agent.cjs') not in paths:raise RuntimeError('Complete Pro source must be indexed before packaging')
if len(set(paths))!=len(paths):raise RuntimeError('Duplicate source index entry')
manifest={}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for relative in sorted(paths):
        file=repo/relative
        if not file.is_file() or file.is_symlink():raise RuntimeError('Source index includes a missing or non-regular file: '+str(relative))
        payload=file.read_bytes();manifest[str(relative)]=hashlib.sha256(payload).hexdigest()
        z.writestr('SSHRelayPro-source/'+str(relative),payload)
    z.writestr('SSHRelayPro-source/SOURCE-MANIFEST.json',json.dumps({'branch':branch,'sourceCommit':commit,'files':manifest},indent=2)+'\n')
print(json.dumps({'archive':output.name,'indexedProjectFiles':len(paths),'bytes':output.stat().st_size}))
checksum=hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(output.suffix+'.sha256').write_text(checksum+'  '+output.name+'\n')
