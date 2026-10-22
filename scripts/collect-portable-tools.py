#!/usr/bin/env python3
"""Collect existing native database clients and their redistributable libraries."""
import hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]).resolve()
platform = sys.argv[2]
vendor = out / 'vendor'
vendor.mkdir(parents=True, exist_ok=True)
provenance = []
def download(url, name, expected=None):
    target = out / name
    if not target.exists():
        with urllib.request.urlopen(url, timeout=300) as r, target.open('wb') as w: shutil.copyfileobj(r, w)
    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    if expected and sha != expected: raise RuntimeError('Input hash mismatch: ' + name)
    provenance.append({'url': url, 'file': name, 'sha256': sha, 'bytes': target.stat().st_size})
    return target

node = 'node-v24.22.0-' + ('win-x64.zip' if platform == 'windows' else 'linux-x64.tar.xz')
pins = json.loads((ROOT / 'assets/portable-runtime-inputs.json').read_text())
download('https://nodejs.org/dist/v24.22.0/' + node, node, pins[node])
electron = 'electron-v44.8.0-' + ('win32-x64.zip' if platform == 'windows' else 'linux-x64.zip')
download('https://github.com/electron/electron/releases/download/v44.8.0/' + electron, electron, pins[electron])
if platform == 'windows':
    download('https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET4.exe', 'WinSW.NET4.exe', pins['WinSW.NET4.exe'])
    download('https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt', 'WinSW-LICENSE')

for tool, url in {
    'mongodb-tools': 'https://fastdl.mongodb.org/tools/db/mongodb-database-tools-' + ('windows-x86_64-100.17.0.zip' if platform == 'windows' else 'ubuntu2404-x86_64-100.17.0.tgz'),
    'mongosh': 'https://github.com/mongodb-js/mongosh/releases/download/v2.13.0/mongosh-2.13.0-' + ('win32-x64.zip' if platform == 'windows' else 'linux-x64.tgz'),
}.items():
    name = tool + '-' + platform + ('.zip' if platform == 'windows' else '.tgz')
    archive = download(url, name, pins[name])
    with tempfile.TemporaryDirectory() as temp:
        if platform == 'windows':
            with zipfile.ZipFile(archive) as z: z.extractall(temp)
        else:
            with tarfile.open(archive) as t: t.extractall(temp, filter='data')
        children = list(Path(temp).iterdir())
        source = children[0] if len(children) == 1 and children[0].is_dir() else Path(temp)
        shutil.copytree(source, vendor / tool, dirs_exist_ok=True)

native = vendor / 'database'
(native / 'bin').mkdir(parents=True, exist_ok=True)
(native / 'lib').mkdir(exist_ok=True)
if platform == 'windows':
    pg_roots = sorted(Path('C:/Program Files/PostgreSQL').glob('*'), reverse=True)
    pg = next((p for p in pg_roots if (p / 'bin/pg_dump.exe').exists()), None)
    mysql_exe = shutil.which('mysql.exe')
    candidates = [Path('C:/mysql'), *Path('C:/Program Files/MySQL').glob('*')]
    mysql = Path(mysql_exe).parent.parent if mysql_exe else next((p for p in candidates if (p / 'bin/mysql.exe').exists()), None)
    if not pg or not mysql: raise RuntimeError('Native SQL clients are missing')
    for source, names, toolname in [(pg, ['psql.exe', 'pg_dump.exe', 'pg_restore.exe'], 'postgresql'), (mysql, ['mysql.exe', 'mysqldump.exe'], 'mysql')]:
        destination = vendor / toolname
        (destination / 'bin').mkdir(parents=True, exist_ok=True)
        for name in names: shutil.copy2(source / 'bin' / name, destination / 'bin' / name)
        for dll in (source / 'bin').glob('*.dll'): shutil.copy2(dll, destination / 'bin' / dll.name)
        for directory in ['share', 'lib/plugin']:
            if (source / directory).exists(): shutil.copytree(source / directory, destination / directory, dirs_exist_ok=True)
        for pattern in ['*LICENSE*', '*COPYING*', '*NOTICE*']:
            for item in source.glob(pattern):
                if item.is_file(): shutil.copy2(item, destination / (source.name + '-' + item.name))
    # App-local deployment avoids relying on a VC++ runtime installed on the VM.
    redist = Path('C:/Program Files/Microsoft Visual Studio/2022/Enterprise/VC/Redist/MSVC/14.44.35112/x64/Microsoft.VC143.CRT')
    if not redist.is_dir(): raise RuntimeError('Pinned Visual C++ app-local runtime is missing')
    runtime_files = sorted(redist.glob('*.dll'))
    if not {'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'}.issubset({p.name.lower() for p in runtime_files}): raise RuntimeError('VC++ runtime is incomplete')
    for directory in vendor.glob('*/bin'):
        for dll in runtime_files: shutil.copy2(dll, directory / dll.name)
    notice = vendor / 'microsoft-vc-runtime'
    notice.mkdir()
    license_url = 'https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/'
    with urllib.request.urlopen(license_url, timeout=90) as r: (notice / 'LICENSE.html').write_bytes(r.read())
    (notice / 'NOTICE.txt').write_text('Microsoft Visual C++ 2015-2022 app-local redistributable runtime, 14.44.35112, x64. Copyright Microsoft.\nLicense: ' + license_url + '\nRedistribution list: https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution\n')
    provenance.append({'microsoftAppLocalCRT': '14.44.35112', 'origin': str(redist), 'license': license_url,
        'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in runtime_files}})
else:
    for name in ['psql', 'pg_dump', 'pg_restore', 'mysql', 'mysqldump']:
        source = Path('/usr/lib/postgresql/16/bin') / name if name in ['psql', 'pg_dump', 'pg_restore'] else Path(shutil.which(name) or '/missing')
        if not source.exists(): raise RuntimeError('Missing native database client: ' + name)
        shutil.copy2(source, native / 'bin' / name)
    # Do not bundle or replace the operating system's libc/loader.
    for binary in list((native / 'bin').iterdir()) + list((vendor / 'mongodb-tools/bin').iterdir()) + list((vendor / 'mongosh/bin').iterdir()):
        if not binary.is_file(): continue
        result = subprocess.run(['ldd', str(binary)], capture_output=True, text=True)
        for library in re.findall(r'=> (/\S+)', result.stdout):
            source = Path(library)
            if source.name.startswith(('libc.so', 'libm.so', 'libpthread.so', 'libdl.so', 'librt.so', 'ld-linux')): continue
            shutil.copy2(source, native / 'lib' / source.name)
    for name in ['postgresql-client-16', 'mysql-client-8.0', 'libpq5', 'mysql-common']:
        source = Path('/usr/share/doc') / name
        if source.exists(): shutil.copytree(source, native / 'licenses' / name, dirs_exist_ok=True, symlinks=True)
    if Path('/usr/share/postgresql/16').exists(): shutil.copytree('/usr/share/postgresql/16', native / 'share/postgresql')
    provenance.append({'nativePackages': subprocess.check_output(['dpkg-query', '-W', 'postgresql-client-16', 'mysql-client-8.0', 'libpq5'], text=True)})

tools = {}
for name in ['psql', 'pg_dump', 'pg_restore', 'mysql', 'mysqldump']:
    directory = vendor / ('postgresql' if name in ['psql', 'pg_dump', 'pg_restore'] else 'mysql') if platform == 'windows' else native
    binary = directory / 'bin' / (name + ('.exe' if platform == 'windows' else ''))
    result = subprocess.run([str(binary), '--version'], capture_output=True, text=True, env={**os.environ, 'LD_LIBRARY_PATH': str(native / 'lib')})
    if result.returncode: raise RuntimeError('Bundled SQL client cannot start: ' + name + result.stderr)
    tools[name] = result.stdout.strip()
(vendor / 'PROVENANCE.json').write_text(json.dumps({'downloads': provenance, 'sqlClientVersions': tools}, indent=2) + '\n')
print(json.dumps({'collected': platform, 'sqlClients': tools}), flush=True)
