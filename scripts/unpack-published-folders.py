#!/usr/bin/env python3
"""Extract repository-downloaded archives and verify the published checksums."""
import hashlib, json, os, sys, tarfile, zipfile
from pathlib import Path
download, destination = map(lambda x: Path(x).resolve(), sys.argv[1:3])
platform = sys.argv[3]
checksums = dict(line.split(maxsplit=1)[::-1] for line in (download / 'SHA256SUMS').read_text().splitlines() if line.strip())
destination.mkdir(parents=True, exist_ok=True)
folders = {}
for role in ['near', 'far']:
    name = f'SSHRelay-{role}-{platform}-x64'
    archive = download / (name + ('.zip' if platform == 'windows' else '.tar.gz'))
    if hashlib.sha256(archive.read_bytes()).hexdigest() != checksums[archive.name]: raise RuntimeError('Published archive hash mismatch')
    if platform == 'windows':
        with zipfile.ZipFile(archive) as z: z.extractall(destination)
    else:
        with tarfile.open(archive) as t: t.extractall(destination, filter='data')
    folder = destination / name
    inventory = json.loads((folder / 'FILES-SHA256.json').read_text())
    for relative, expected in inventory.items():
        if hashlib.sha256((folder / relative).read_bytes()).hexdigest() != expected: raise RuntimeError('Extracted file hash mismatch: ' + relative)
    folders[role] = str(folder)
    print(json.dumps({'downloaded': archive.name, 'verifiedFiles': len(inventory)}))
with open(os.environ['GITHUB_ENV'], 'a') as f:
    for role, folder in folders.items(): f.write(role.upper() + '_FOLDER=' + folder + '\n')
