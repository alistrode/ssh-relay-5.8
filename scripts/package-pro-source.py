#!/usr/bin/env python3
"""Archive indexed project files only; never include runtime/private directories."""
from pathlib import Path
import hashlib,json,subprocess,zipfile,sys

repo=Path(__file__).resolve().parents[1]
output=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else repo/'deliverables/pro/source.zip'
output.parent.mkdir(parents=True,exist_ok=True)
entries=subprocess.check_output(['git','ls-files','-z'],cwd=repo).split(b'\0')
paths=[Path(p.decode()) for p in entries if p and (not p.decode().startswith('deliverables/') or p.decode().endswith('.md'))]
assert any(str(p)=='src/pro/agent.cjs' for p in paths),'Stage the complete Pro source before packaging'
forbidden={'node_modules','data','dist','.runtime-cache','.ssh-relay-pro','__pycache__'}
assert not any(forbidden.intersection(p.parts) for p in paths)
assert not any(p.name in ['agent-runtime.json','guardian-runtime.json','connection.json','client_key','host_key'] for p in paths)
manifest={}
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for relative in sorted(paths):
        file=repo/relative
        assert file.is_file() and not file.is_symlink(),str(relative)
        payload=file.read_bytes()
        manifest[str(relative)]=hashlib.sha256(payload).hexdigest()
        z.writestr('SSHRelayPro-source/'+str(relative),payload)
    z.writestr('SSHRelayPro-source/SOURCE-MANIFEST.json',json.dumps({'branch':subprocess.check_output(['git','branch','--show-current'],cwd=repo,text=True).strip(),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'files':manifest},indent=2)+'\n')
print(json.dumps({'archive':output.name,'indexedProjectFiles':len(paths),'bytes':output.stat().st_size}))
directory=output.parent
(directory/'SHA256SUMS').write_text(''.join(hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name+'\n' for file in sorted(directory.iterdir()) if file.is_file() and file.name!='SHA256SUMS'))
