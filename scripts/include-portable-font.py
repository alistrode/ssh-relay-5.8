#!/usr/bin/env python3
"""Add the licensed GUI font to the exact native bundles; refresh inventories."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, tarfile, tempfile, zipfile
ROOT = Path(__file__).resolve().parents[1]
complete = Path(sys.argv[1]).resolve()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
font = ROOT / 'assets/fonts/NotoSansCJKsc-Regular.otf'
if sha(font) != '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b': raise RuntimeError('Font hash mismatch')
for archive in sorted(complete.iterdir()):
    if not archive.name.startswith('SSHRelay-') or 'source' in archive.name: continue
    with tempfile.TemporaryDirectory(prefix='relay-font-') as temp:
        if archive.suffix == '.zip':
            with zipfile.ZipFile(archive) as z: z.extractall(temp)
        elif archive.name.endswith('.tar.gz'):
            with tarfile.open(archive) as t: t.extractall(temp, filter='data')
        else: continue
        folder = next(Path(temp).iterdir())
        app = folder / 'resources/app'
        shutil.copytree(ROOT / 'assets/fonts', app / 'assets/fonts', dirs_exist_ok=True)
        shutil.copyfile(ROOT / 'desktop/style.css', app / 'desktop/style.css')
        package = json.loads((folder / 'PACKAGE.json').read_text())
        package['guiAssetsCommit'] = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        package['bundledCJKFontSHA256'] = sha(font)
        (folder / 'PACKAGE.json').write_text(json.dumps(package, indent=2) + '\n')
        inventory = {str(p.relative_to(folder)): sha(p) for p in sorted(folder.rglob('*')) if p.is_file() and not p.is_symlink() and p.name != 'FILES-SHA256.json'}
        (folder / 'FILES-SHA256.json').write_text(json.dumps(inventory, indent=2) + '\n')
        if archive.suffix == '.zip':
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for p in sorted(folder.rglob('*')): z.write(p, str(Path(folder.name) / p.relative_to(folder)))
        else:
            with tarfile.open(archive, 'w:gz', compresslevel=6) as t: t.add(folder, arcname=folder.name)
    print(json.dumps({'fontIncluded': archive.name, 'sha256': sha(archive), 'bytes': archive.stat().st_size}), flush=True)
