'use strict';
// Run with aedes available in NODE_PATH; all traffic stays on a private loopback broker.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const aedes = require('aedes')();
const { Agent } = require('../../src/pro/agent.cjs');
const { join, offer } = require('../../src/pro/pairing.cjs');
const { keyPair } = require('../../src/pro/keys.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const server = net.createServer(aedes.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const broker = 'mqtt://127.0.0.1:' + server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-agent-reuse-'));
  const far = { role: 'far', dir, broker, info: { deviceId: crypto.randomUUID() }, settings: { label: 'test' }, log() {}, file(name) { return path.join(dir, name); }, createPair(invitation) { return Agent.prototype.createPair.call(this, invitation); } };
  const who = () => ({ deviceId: crypto.randomUUID(), publicKey: keyPair().publicKey });
  const connect = (code, identity = who()) => join({ broker, code, who: identity, accept: async () => {}, timeout: 1200 });
  let expiring;
  try {
    const before = Date.now();
    const first = await Agent.prototype.createPair.call(far);
    assert(first.expiresAt >= before + 86400000 && first.expiresAt <= Date.now() + 86400000);
    const identities = [who(), who(), who()];
    await connect(first.code, identities[0]);
    await delay(3500); // Past the old receipt-triggered cancellation window.
    await Promise.all(identities.slice(1).map(identity => connect(first.code, identity)));
    const clients = JSON.parse(fs.readFileSync(path.join(dir, 'far/authorized-clients.json')));
    assert.deepEqual(Object.keys(clients).sort(), identities.map(x => x.deviceId).sort());
    assert(far.offer.active);
    const wrong = first.code.slice(0, -1) + (first.code.endsWith('2') ? '3' : '2');
    await assert.rejects(connect(wrong));
    const replacement = await Agent.prototype.createPair.call(far);
    await connect(first.code);
    await connect(replacement.code);
    assert.equal([...far.pairOffers][0].expiresAt, first.expiresAt);
    for (const live of far.pairOffers) live.cancel();
    far.pairOffers.clear();
    await Agent.prototype.restorePairInvitations.call(far);
    await connect(first.code);
    await connect(replacement.code);
    assert.equal([...far.pairOffers][0].expiresAt, first.expiresAt);
    assert.equal([...far.pairOffers][1].expiresAt, replacement.expiresAt);
    expiring = await offer({ broker, info: far.info, authorize: async () => {}, reusable: true, ttl: 100 });
    await delay(150);
    assert.equal(expiring.active, false);
    await assert.rejects(connect(expiring.code));
    console.log('PASS: actual Agent createPair keeps a 24-hour code reusable for sequential/concurrent clients; new codes preserve old codes; restart restores both original deadlines; wrong and expired codes fail');
  } finally {
    for (const live of far.pairOffers || []) live.cancel();
    expiring?.cancel();
    await new Promise(resolve => aedes.close(resolve));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
