"use strict";
// Public broker; fresh owned near/far profiles. Never upload profiles or raw logs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { Agent } = require('../../src/pro/agent.cjs');
const { request } = require('../../src/pro/cli.cjs');
const { Client } = require('ssh2');
const repo = path.resolve(__dirname, '../..');
const output = path.join(repo, 'stability-results');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-hour-'));
const windows = process.platform === 'win32', duration = 3600;
const broker = 'wss://broker.emqx.io:8084/mqtt';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let far, near, measured = false, fatal, started, baseline, samples = 0;
const clients = new Set(), channels = [], events = [];
const result = { passed: false, commit: process.env.GITHUB_SHA || null,
  platform: process.platform, osRelease: os.release(), osVersion: os.version(),
  runnerImage: process.env.ImageOS || null, node: process.version,
  requiredSeconds: duration, publicBroker: broker, cloudSelfTest: true,
  scope: 'Native near/far relay on each VM; not GUI, cross-VM or Windows 10 certification',
  clientKeepaliveEnabled: false, interventions: 0, samples: 0 };
function hashSource() {
  const hash = crypto.createHash('sha256');
  for (const dir of ['src', 'desktop', 'launchers']) {
    const walk = relative => { for (const name of fs.readdirSync(path.join(repo, relative)).sort()) {
      const file = path.join(relative, name);
      if (fs.statSync(path.join(repo, file)).isDirectory()) walk(file);
      else { hash.update(file.split(path.sep).join('/')); hash.update(fs.readFileSync(path.join(repo, file))); }
    }}; walk(dir);
  } return hash.digest('hex');
}
function save() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
}
async function bounded(promise, ms = 60000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Probe timed out')), ms);
  })]); } finally { clearTimeout(timer); }
}
async function untilOnline() {
  const end = performance.now() + 180000;
  while (performance.now() < end) {
    const device = near.status().devices[0];
    if (device?.state === 'online') return device;
    await pause(500);
  } throw Error('Initial public relay did not become online');
}
async function connect(report) {
  const c = new Client(); clients.add(c);
  c.on('error', () => { if (measured) fatal ||= Error('SSH transport error'); });
  await bounded(new Promise((resolve, reject) => {
    c.once('ready', resolve); c.once('error', reject);
    c.connect({ host: '127.0.0.1', port: report.local_port, username: 'relay',
      privateKey: fs.readFileSync(report.ssh_argv[report.ssh_argv.indexOf('-i') + 1]),
      readyTimeout: 45000, keepaliveInterval: 0,
      hostVerifier: key => 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === report.host_fingerprint });
  })); return c;
}
async function exec(c, command) {
  return bounded(new Promise((resolve, reject) => c.exec(command, (error, stream) => {
    if (error) return reject(error);
    let stdout = ''; stream.on('data', data => stdout += data);
    stream.on('error', reject); stream.on('close', code => code === 0 ? resolve(stdout) : reject(Error('SSH command failed')));
  })));
}
async function longConnection(report, active) {
  const c = await connect(report), state = { active, ticks: 0, ready: false, closed: false };
  const command = windows
    ? (active ? "Write-Output 'hour-ready'; while ($true) { Write-Output 'hour-tick'; Start-Sleep -Seconds 15 }" : "Write-Output 'hour-ready'; Start-Sleep -Seconds 3900")
    : (active ? "printf 'hour-ready\\n'; while :; do printf 'hour-tick\\n'; sleep 15; done" : "printf 'hour-ready\\n'; sleep 3900");
  await bounded(new Promise((resolve, reject) => c.exec(command, (error, stream) => {
    if (error) return reject(error);
    let buffer = '';
    stream.on('data', data => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (line.trim() === 'hour-ready') { state.ready = true; resolve(); }
        if (line.trim() === 'hour-tick') { state.ticks++; state.lastTick = performance.now(); }
      }
    });
    stream.on('error', reject);
    stream.on('close', () => { state.closed = true; if (measured) fatal ||= Error('Long SSH channel closed'); });
    c.on('close', () => { state.closed = true; if (measured) fatal ||= Error('Long SSH connection closed'); });
  })));
  channels.push(state);
}
async function sample(report) {
  const c = await connect(report);
  try {
    const nonce = crypto.randomBytes(12).toString('hex');
    assert.equal((await exec(c, windows ? "[Console]::Write('" + nonce + "')" : 'printf ' + nonce)).trim(), nonce);
    const sftp = await bounded(new Promise((resolve, reject) => c.sftp((e, s) => e ? reject(e) : resolve(s))));
    const file = path.join(root, 'transfer.bin'), data = crypto.randomBytes(65536);
    await bounded(new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(file); stream.on('error', reject); stream.on('close', resolve); stream.end(data);
    }));
    const read = await bounded(new Promise((resolve, reject) => {
      const buffers = [], stream = sftp.createReadStream(file);
      stream.on('data', b => buffers.push(b)); stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(buffers)));
    }));
    assert(read.equals(data), 'SFTP content mismatch'); sftp.end(); samples++;
  } finally { clients.delete(c); c.destroy(); }
}
function observe(entry) {
  if (!measured) return;
  const event = entry.trace?.event || entry.event;
  if (['worker_exited', 'connection_failed', 'mqtt_offline'].includes(event)) {
    events.push(event); fatal ||= Error('Unexpected relay event: ' + event);
  }
}
function healthy() {
  if (fatal) throw fatal;
  assert.equal(near.status().devices[0]?.state, 'online', 'Device left online state');
  assert(channels.every(c => !c.closed), 'Long SSH channel ended');
  assert(channels.filter(c => c.active).every(c => performance.now() - (c.lastTick || started) < 60000), 'Active SSH heartbeat stalled');
  for (const [agent, previous] of [[near, baseline.near], [far, baseline.far]]) {
    assert.equal(agent.stats.workerRestarts, previous.workerRestarts, 'Worker restarted');
    assert.equal(agent.stats.disconnects, previous.disconnects, 'Relay disconnected');
    for (const worker of agent.children.values()) assert(worker.child.exitCode === null && worker.child.signalCode === null, 'Worker exited');
  }
}
(async () => {
  try {
    result.sourceHash = hashSource(); save();
    far = new Agent({ role: 'far', dir: path.join(root, 'far'), allowCloudSelfTest: true, brokerUrl: broker });
    near = new Agent({ role: 'near', dir: path.join(root, 'near'), allowCloudSelfTest: true, brokerUrl: broker });
    far.emit = observe; near.emit = observe;
    await bounded(far.start()); await bounded(near.start());
    const offer = await bounded(request(path.join(root, 'far'), '/pair/create', {}));
    await bounded(request(path.join(root, 'near'), '/pair/connect', { code: offer.code }));
    const device = await untilOnline();
    const report = JSON.parse(fs.readFileSync(device.connectionReport));
    assert.equal(report.cloud_self_test, true);
    await longConnection(report, true); await longConnection(report, false); await sample(report);
    baseline = { near: { ...near.stats }, far: { ...far.stats } };
    started = performance.now(); measured = true; result.startedAtUtc = new Date().toISOString();
    console.log('HOUR START', JSON.stringify({ ...result, sourceHash: result.sourceHash }));
    let lastSample = started;
    while (performance.now() - started < duration * 1000) {
      healthy();
      if (performance.now() - lastSample >= 15000) {
        await sample(report); healthy(); lastSample = performance.now();
        result.samples = samples; result.elapsedSeconds = (performance.now() - started) / 1000;
        result.activeTicks = channels[0].ticks; save();
        console.log('HOUR PROGRESS', JSON.stringify({ seconds: Math.floor(result.elapsedSeconds), samples, activeTicks: result.activeTicks }));
      }
      await pause(1000);
    }
    await sample(report); healthy(); assert.equal(hashSource(), result.sourceHash, 'Source changed during hour');
    assert(channels[0].ticks >= 200, 'Insufficient active SSH heartbeats');
    result.elapsedSeconds = (performance.now() - started) / 1000;
    assert(result.elapsedSeconds >= duration); result.passed = true;
  } catch (error) {
    result.failure = error.message; process.exitCode = 1;
    console.error('HOUR FAILED', error.message);
  } finally {
    measured = false; result.samples = samples; result.unexpectedEvents = events;
    result.finishedAtUtc = new Date().toISOString(); result.activeTicks = channels[0]?.ticks || 0;
    save(); console.log('HOUR RESULT', JSON.stringify(result));
    for (const c of clients) c.destroy();
    await bounded(Promise.allSettled([near?.close(), far?.close()]), 30000).catch(() => { process.exitCode = 1; });
  }
})();
