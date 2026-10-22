"use strict";
// Lease the downloaded package itself for manually selected direct MCP calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), cp = require('node:child_process');
const folder = path.resolve(process.argv[2]), app = path.join(folder, 'resources/app');
const entry = path.join(app, 'launchers/portable-entry.cjs');
const node = path.join(folder, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const { request, stateDirectory } = require(path.join(app, 'src/pro/agent-client.cjs'));
const dir = stateDirectory({ role: 'far' });
(async () => {
  if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Temporary Actions hosts only');
  if (process.argv[3] === 'offer') {
    // Capture the locally displayed pairing material; never print it in Actions logs.
    const start = cp.spawnSync(node, [entry, '--headless'], { encoding: 'utf8', timeout: 60000 });
    if (start.status !== 0) throw Error('Downloaded package Start failed');
    const offer = await request(dir, '/pair/create', {});
    const identity = JSON.parse(fs.readFileSync(path.join(dir, 'identity.json')));
    const message = { code: offer.code, deviceId: identity.deviceId, expiresAt: offer.expiresAt,
      folder, hostname: os.hostname(), platform: process.platform, home: os.homedir(), node };
    const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
    const sealed = crypto.publicEncrypt({ key: fs.readFileSync('.github/operator-public-key.pem'), oaepHash: 'sha256' }, key);
    fs.mkdirSync('operator-exchange', { recursive: true });
    fs.writeFileSync('operator-exchange/offer.json', JSON.stringify({ algorithm: 'RSA-OAEP-SHA256+A256GCM', key: sealed.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: bytes.toString('base64') }));
    console.log('Downloaded far folder started with bundled Node; sealed authorization ready');
    return;
  }
  const started = Date.now();
  while (Date.now() - started < 7200000) {
    try { const status = await request(dir, '/status'); console.log('FOLDER_HOST', JSON.stringify({ platform: process.platform, seconds: Math.floor((Date.now()-started)/1000), state:status.state })); }
    catch { console.log('FOLDER_HOST waiting for normal application restart'); }
    await new Promise(resolve => setTimeout(resolve, 50000));
  }
  await request(dir, '/shutdown', {});
})().catch(error => { console.error(error.message); process.exitCode = 1; });
