#!/usr/bin/env python3
"""Download pinned upstream runtime inputs through the inherited HTTPS settings."""
from pathlib import Path
import hashlib,json,subprocess,sys

root=Path(__file__).resolve().parents[1]
cache=Path(sys.argv[1] if len(sys.argv)>1 else '.runtime-cache').resolve()
cache.mkdir(parents=True,exist_ok=True)
inputs=json.loads((root/'assets/pro-runtime-inputs.json').read_text())
items=[(entry['file'],f"https://github.com/electron/electron/releases/download/v{inputs['electron']['version']}/{entry['file']}",entry['sha256']) for entry in inputs['electron']['files']]
items.append((inputs['winsw']['file'],inputs['winsw']['url'],inputs['winsw']['sha256']))
for name,url,digest in items:
    target=cache/name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
        temporary=target.with_suffix(target.suffix+'.partial')
        subprocess.run(['curl','--fail','--location','--retry','3','--output',str(temporary),url],check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=digest:
            temporary.unlink(missing_ok=True)
            raise RuntimeError('Runtime checksum mismatch: '+name)
        temporary.replace(target)
    print(name+' verified')
license_file=cache/'WinSW-LICENSE'
subprocess.run(['curl','--fail','--location','--retry','3','--output',str(license_file),'https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt'],check=True)
