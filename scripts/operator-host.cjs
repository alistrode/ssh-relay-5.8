"use strict";
// Lease a normal native Agent on a disposable runner. No test cases or patches.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { ensureAgent, request, stateDirectory } = require('../src/pro/agent-client.cjs');
const dir = stateDirectory({ role: 'far' }), output = path.resolve('operator-exchange');
(async () => {
  if (process.env.GITHUB_ACTIONS !== 'true') throw Error('This host launcher is for the requested temporary Actions VMs');
  await ensureAgent({ role: 'far' });
  if (process.argv[2] === 'offer') {
    const offer = await request(dir, '/pair/create', {});
    const identity = JSON.parse(fs.readFileSync(path.join(dir, 'identity.json')));
    const message = { code: offer.code, expiresAt: offer.expiresAt, deviceId: identity.deviceId,
      hostname: os.hostname(), username: os.userInfo().username, home: os.homedir(),
      platform: process.platform, node: process.execPath, commit: process.env.GITHUB_SHA };
    // Hybrid encryption: pairing material and host metadata never enter logs or Git.
    const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
    const sealedKey = crypto.publicEncrypt({ key: fs.readFileSync('.github/operator-public-key.pem'), oaepHash: 'sha256' }, key);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'offer.json'), JSON.stringify({ algorithm: 'RSA-OAEP-SHA256+A256GCM',
      key: sealedKey.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: bytes.toString('base64') }));
    console.log('Normal far Agent started; encrypted one-time authorization ready');
    return;
  }
  const started = Date.now(), seconds = Number(process.argv[3] || 10800);
  console.log('Native Agent lease started', JSON.stringify({ platform: process.platform, osVersion: os.version(), commit: process.env.GITHUB_SHA }));
  while (Date.now() - started < seconds * 1000) {
    const status = await request(dir, '/status');
    console.log('LEASE', JSON.stringify({ seconds: Math.floor((Date.now() - started) / 1000), state: status.state, stats: status.stats }));
    await new Promise(resolve => setTimeout(resolve, 50000));
  }
  await request(dir, '/shutdown', {});
})().catch(error => { console.error('Native host unavailable:', error.message); process.exitCode = 1; });
