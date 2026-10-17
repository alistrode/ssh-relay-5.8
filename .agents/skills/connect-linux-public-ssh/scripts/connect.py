#!/usr/bin/env python3
"""Import the user's printed connection block and verify the actual remote."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['linux', 'win10'], required=True)
    parser.add_argument('--info-file', required=True)
    parser.add_argument('--state-dir', default='/workspace/ssh-relay-state' if pathlib.Path('/workspace').is_dir() else str(pathlib.Path.home() / '.ssh-relay-state'))
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--allow-cloud-self-test', action='store_true')
    parser.add_argument('--command')
    args = parser.parse_args()
    raw = pathlib.Path(args.info_file).read_text(encoding='utf-8-sig')
    section = re.search(r'^[= \t]*SSH_RELAY_CONNECT_BEGIN[= \t]*\r?\n(.*?)^[= \t]*SSH_RELAY_CONNECT_END[= \t]*$', raw, re.M | re.S)
    if not section:
        raise ValueError('Missing complete SSH_RELAY_CONNECT block; do not use old Cloudflare information.')
    match = re.search(r'(?m)^TARGET=(linux|win10)\s*$', section.group(1))
    if not match or 'BUNDLE=' not in section.group(1):
        raise ValueError('Missing TARGET or BUNDLE field')
    encoded = re.sub(r'\s+', '', section.group(1).split('BUNDLE=', 1)[1])
    compressed = base64.b64decode(encoded, validate=True)
    if len(compressed) > 8192:
        raise ValueError('Oversized connection block')
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        data = stream.read(16385)
    if len(data) > 16384:
        raise ValueError('Oversized decoded connection block')
    info = json.loads(data)
    if info.get('version') != 1 or info.get('target') != args.platform or match.group(1) != args.platform:
        raise ValueError('Wrong skill or unsupported connection format')
    if info.get('broker') != 'wss://broker.emqx.io:8084/mqtt' or info.get('user') != 'relay':
        raise ValueError('Unsupported broker or SSH username')
    if not re.fullmatch('[a-f0-9]{32}', info.get('session', '')) or not re.fullmatch('[a-f0-9]{64}', info.get('secret', '')):
        raise ValueError('Invalid session credentials')
    public = info.get('hostPublicKey', '').split()
    if len(public) != 2 or public[0] != 'ssh-ed25519':
        raise ValueError('Invalid host public key')
    fp = 'SHA256:' + base64.b64encode(hashlib.sha256(base64.b64decode(public[1], validate=True)).digest()).decode().rstrip('=')
    if fp != info.get('fingerprint'):
        raise ValueError('Host fingerprint mismatch in connection block')
    key = info.get('clientPrivateKey', '')
    if not key.startswith('-----BEGIN OPENSSH PRIVATE KEY-----\n') or len(key) > 8192:
        raise ValueError('Invalid client key format')
    if not args.node or not shutil.which('ssh'):
        raise ValueError('Node.js 22+ and OpenSSH client are required on the near end')
    version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22:
        raise ValueError('Node.js 22+ is required')
    assets = pathlib.Path(__file__).resolve().parents[4] / 'src' / 'near.cjs'
    if not assets.is_file():
        raise ValueError('Missing project src/near.cjs; use this skill inside the complete repository and run npm ci --ignore-scripts at the repository root')
    folder = pathlib.Path(args.state_dir).resolve() / info['session']
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder.chmod(0o700)
    def private(name, value):
        p = folder / name
        if p.is_symlink():
            raise ValueError('Refusing a symlink in private state')
        with os.fdopen(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
            f.write(value)
        p.chmod(0o600)
        return p
    key_path = private('client_key', key)
    alias = 'relay-' + info['session']
    known = private('known_hosts', alias + ' ' + ' '.join(public) + '\n')
    runtime_path = folder / 'runtime.json'
    port = None
    if runtime_path.exists():
        runtime = json.loads(runtime_path.read_text())
        try:
            os.kill(runtime['pid'], 0)
            with socket.create_connection(('127.0.0.1', runtime['port']), timeout=1):
                port = runtime['port']
        except (OSError, KeyError):
            pass
    if port is None:
        # A previous peer report must not let verification race a newly starting listener.
        (folder / 'peer.json').unlink(missing_ok=True)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        config = {k: info[k] for k in ['broker', 'session', 'secret', 'user', 'fingerprint']}
        config.update(localPort=port, statusPath=str(folder / 'peer.json'))
        config_path = private('near.json', json.dumps(config))
        with open(folder / 'near.log', 'ab') as log:
            proc = subprocess.Popen([args.node, str(assets), str(config_path)], stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=log, start_new_session=True)
        private('runtime.json', json.dumps({'pid': proc.pid, 'port': port}))
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            peer = json.loads((folder / 'peer.json').read_text())
            if peer.get('fingerprint') == fp and abs(time.time() * 1000 - peer['receivedAt']) < 45000:
                break
        except (FileNotFoundError, ValueError, KeyError):
            pass
        time.sleep(.25)
    else:
        raise ValueError('No authenticated peer status; inspect near.log and confirm the remote window remains running')
    argv = ['ssh', '-F', os.devnull, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known),
            '-o', 'HostKeyAlias=' + alias, '-o', 'ConnectTimeout=20', '-i', str(key_path),
            '-p', str(port), 'relay@127.0.0.1']
    command = 'whoami; hostname' if args.platform == 'linux' else 'whoami & hostname'
    probe = subprocess.run(argv + [command], stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='replace', timeout=50)
    if probe.returncode:
        raise ValueError('Pinned SSH identity check failed: ' + probe.stderr[-600:])
    lines = [line.strip() for line in probe.stdout.splitlines() if line.strip()]
    if len(lines) < 2:
        raise ValueError('SSH returned no complete remote identity')
    is_self = lines[-1].casefold() == socket.gethostname().casefold()
    report = {'connected': True, 'target': args.platform, 'remote_user': lines[0],
              'remote_hostname': lines[-1], 'host_fingerprint': fp, 'cloud_self_test': is_self,
              'ssh_argv': argv, 'state_directory': str(folder),
              'permission_context': peer.get('permissions'),
              'relay_protocol': peer.get('relayProtocol', 1),
              'reliable_delivery': peer.get('relayProtocol') == 2,
              'permission_comparison': 'not_compared_to_local_codex'}
    if is_self and not args.allow_cloud_self_test:
        report['connected'] = False
        report['error'] = 'Connected to cloud self-test, not the user computer; stop before project operations.'
        print(json.dumps(report, ensure_ascii=False, indent=2)); return 3
    if args.command:
        result = subprocess.run(argv + [args.command], stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='replace', timeout=120)
        report.update(stdout=result.stdout, stderr=result.stderr, exit_code=result.returncode)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report.get('exit_code', 0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        print('CONNECT_ERROR: ' + str(e), file=sys.stderr)
        sys.exit(2)
