// Real MCP client -> owned native Agent -> public WSS relay -> native operations.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const require = createRequire(import.meta.url), { Agent } = require('../../src/pro/agent.cjs');
const { request } = require('../../src/pro/cli.cjs');
const repo = path.resolve(import.meta.dirname, '../..'), windows = process.platform === 'win32';
if (process.env.GITHUB_ACTIONS !== 'true') throw Error('Full native mutations are restricted to disposable GitHub Actions VMs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-all-ai-')), nearDir = path.join(root, 'near');
const output = path.join(repo, 'ai-results'); fs.mkdirSync(output, { recursive: true });
const coreOnly = process.argv.includes('--core');
const requiredSeconds = coreOnly ? 0 : Number(process.argv[2] ?? 3600), rows = [], clients = new Set(), listeners = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => "'" + value.replaceAll("'", windows ? "''" : "'\\''") + "'";
const echo = value => windows ? '[Console]::Write(' + quote(value) + ')' : 'printf %s ' + quote(value);
let near, far, client, transport, tools = [], measuring = false, runtimeFailure, hourStart, ticks = 0;
const summary = { passed: false, commit: process.env.GITHUB_SHA, platform: process.platform,
  osVersion: os.version(), node: process.version, scope: 'All 39 Agent MCP tools and native operations; Windows Server is not Windows 10',
  requiredSeconds, phase: coreOnly ? 'non-database-direct-MCP' : 'all-tools-and-hour', cloudSelfTest: true, interventionsDuringHour: 0, checks: rows };
function save() { fs.writeFileSync(path.join(output, coreOnly ? 'coverage-core.json' : 'coverage.json'), JSON.stringify(summary, null, 2)); }
function native(args, options = {}) {
  const r = cp.spawnSync(args[0], args.slice(1).map(String), { encoding: 'utf8', timeout: 120000, windowsHide: true, ...options });
  if (r.error || r.status !== 0) throw Error(path.basename(args[0]) + ' fixture command failed: ' + (r.error?.message || r.stderr?.slice(0, 350)));
  return r.stdout;
}
async function check(label, name, args = {}, expectedError = false, verify = () => {}) {
  const row = { label, tool: name, action: args.action || null, type: args.type || null, expectedError, passed: false };
  const started = performance.now();
  try {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 330000 });
    const value = JSON.parse(response.content[0].text);
    assert.equal(!!response.isError, expectedError, name + ': ' + JSON.stringify(value).slice(0, 600));
    await verify(value); row.passed = true; return value;
  } catch (error) { row.error = error.message.slice(0, 700); return null; }
  finally { row.ms = Math.round(performance.now() - started); rows.push(row); save(); console.log('AI CHECK', label, row.passed ? 'PASS' : 'FAIL', row.error || ''); }
}
async function must(label, name, args = {}, verify = () => {}) {
  const result = await check(label, name, args, false, verify);
  if (!result) throw Error('Required AI operation failed: ' + label);
  return result;
}
async function mcpStart() {
  transport = new StdioClientTransport({ command: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    args: [path.join(repo, 'src/mcp.cjs'), '--agent-dir', nearDir, '--state-dir', path.join(root, 'mcp'), '--allow-cloud-self-test', 'yes'], stderr: 'pipe' });
  transport.stderr.on('data', () => {}); // Private runtime output is never published.
  client = new Client({ name: 'all-ai-native-acceptance', version: '1' }); await client.connect(transport);
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const p = server.address().port; await new Promise(resolve => server.close(resolve)); return p;
}
async function probeTunnel(port, destination, dynamic = false) {
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'), expected = 'ai-tunnel-marker'; let state = dynamic ? 0 : 2, buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Tunnel data timeout')); }, 15000);
    socket.on('error', reject); socket.on('close', () => clearTimeout(timer));
    socket.on('connect', () => socket.write(dynamic ? Buffer.from([5, 1, 0]) : expected));
    socket.on('data', bytes => {
      buffer = Buffer.concat([buffer, bytes]);
      if (state === 0 && buffer.length >= 2) {
        assert.equal(buffer[1], 0); buffer = buffer.subarray(2); state = 1;
        socket.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, destination >> 8, destination & 255]));
      }
      if (state === 1 && buffer.length >= 10) { assert.equal(buffer[1], 0); buffer = buffer.subarray(10); state = 2; socket.write(expected); }
      if (state === 2 && buffer.toString() === expected) { clearTimeout(timer); socket.destroy(); resolve(); }
    });
  });
}
async function untilState(fn, predicate, seconds = 90) {
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) { const value = await fn(); if (predicate(value)) return value; await pause(500); }
  throw Error('Observable native state did not converge');
}
const server = 'target';
async function basicAndFiles(cycle) {
  const dir = path.join(root, 'operations-' + cycle); fs.mkdirSync(dir);
  await must('list-and-verify-target', 'ssh_list_servers', {}, value => assert(JSON.stringify(value).includes(os.hostname())));
  const execute = await must('execute-exact-output', 'ssh_execute', { server, command: echo('ai-command-marker') }, value => {
    assert.equal(value.stdout, 'ai-command-marker'); assert.equal(value.code, 0); assert.equal(value.persistent, true);
  });
  await must('operation-query-original-id', 'ssh_operation_status', { operationId: execute.operationId, action: 'status' }, value => assert(value.operationId === execute.operationId));
  await check('execute-real-nonzero-stderr', 'ssh_execute', { server, command: windows ? "[Console]::Error.Write('ai-stderr'); exit 7" : 'printf ai-stderr >&2; exit 7' }, true, value => {
    assert.equal(value.code, 7); assert.equal(value.stderr, 'ai-stderr');
  });
  const source = path.join(dir, 'source.bin'), remote = path.join(dir, 'remote.bin'), downloaded = path.join(dir, 'downloaded.bin');
  const bytes = crypto.randomBytes(131073); fs.writeFileSync(source, bytes);
  const upload = await must('upload-snapshot-exact-bytes', 'ssh_upload', { server, localPath: source, remotePath: remote }, () => assert(fs.readFileSync(remote).equals(bytes)));
  if (upload.transferId) {
    await must('transfer-query-original-id', 'ssh_operation_status', { server, transferId: upload.transferId });
    await must('transfer-resume-does-not-repeat-commit', 'ssh_operation_status', { server, transferId: upload.transferId, resumeTransfer: true }, () => assert(fs.readFileSync(remote).equals(bytes)));
  }
  await must('download-snapshot-exact-bytes', 'ssh_download', { server, remotePath: remote, localPath: downloaded }, () => assert(fs.readFileSync(downloaded).equals(bytes)));
  fs.mkdirSync(path.join(dir, 'tree/sub'), { recursive: true }); fs.writeFileSync(path.join(dir, 'tree/sub/entry'), 'sync-marker'); fs.writeFileSync(path.join(dir, 'tree/excluded'), 'preserved');
  const sync = { server, source: 'local:' + path.join(dir, 'tree'), destination: 'remote:' + path.join(dir, 'synced'), exclude: ['excluded'] };
  await must('sync-dry-run-has-no-effects', 'ssh_sync', { ...sync, dryRun: true }, () => assert(!fs.existsSync(path.join(dir, 'synced'))));
  await must('sync-checksum-and-exclusion', 'ssh_sync', { ...sync, checksum: true }, () => {
    assert.equal(fs.readFileSync(path.join(dir, 'synced/sub/entry'), 'utf8'), 'sync-marker'); assert(!fs.existsSync(path.join(dir, 'synced/excluded')));
  });
  fs.writeFileSync(path.join(dir, 'synced/remove-me'), 'extra');
  await must('sync-delete-extra-file', 'ssh_sync', { ...sync, delete: true }, () => assert(!fs.existsSync(path.join(dir, 'synced/remove-me'))));
  await must('sync-pull-back', 'ssh_sync', { server, source: 'remote:' + path.join(dir, 'synced'), destination: 'local:' + path.join(dir, 'pulled'), checksum: true }, () => assert.equal(fs.readFileSync(path.join(dir, 'pulled/sub/entry'), 'utf8'), 'sync-marker'));
  const session = await must('session-start', 'ssh_session_start', { server, name: 'ai-session' });
  await must('session-change-directory-and-environment', 'ssh_session_send', { session: session.id, command: windows ? 'Set-Location -LiteralPath ' + quote(dir) + "; $env:RELAY_AI_VALUE='persisted'" : 'cd ' + quote(dir) + '; export RELAY_AI_VALUE=persisted' });
  const retained = await must('session-preserves-state', 'ssh_session_send', { session: session.id, command: windows ? '[Console]::Write($env:RELAY_AI_VALUE)' : 'printf %s "$RELAY_AI_VALUE"' }, value => { assert.equal(value.stdout, 'persisted'); assert.equal(fs.realpathSync(value.cwd), fs.realpathSync(dir)); });
  await must('session-query-request', 'ssh_operation_status', { sessionId: session.id, requestId: retained.requestId });
  await must('session-query-list', 'ssh_operation_status', { sessionId: session.id });
  await must('session-list', 'ssh_session_list', {});
  // Restart only the MCP client before the hour; the original shell must survive.
  if (cycle === 0) {
    await client.close(); await mcpStart();
    await must('session-survives-MCP-restart', 'ssh_session_send', { session: session.id, command: windows ? '[Console]::Write($env:RELAY_AI_VALUE)' : 'printf %s "$RELAY_AI_VALUE"' }, value => assert.equal(value.stdout, 'persisted'));
  }
  await must('session-close', 'ssh_session_close', { session: session.id }, value => assert.equal(value.closed, true));
  await must('deploy-and-inspect-effect', 'ssh_deploy', { server, files: [{ local: source, remote }], options: windows ? { backup: true } : { backup: true, permissions: '600' } }, () => assert(fs.readFileSync(remote).equals(bytes)));
  for (const type of ['files', 'full']) {
    const backupDir = path.join(dir, 'backups-' + type);
    const backup = await must('backup-create-' + type, 'ssh_backup_create', { server, type, name: 'ai', paths: [path.join(dir, 'tree')], backupDir });
    await must('backup-list-' + type, 'ssh_backup_list', { server, type, backupDir });
    await must('backup-restore-' + type, 'ssh_backup_restore', { server, backupId: backup.backup.id, backupDir, targetPath: path.join(dir, 'restored-' + type) }, () => assert.equal(fs.readFileSync(path.join(dir, 'restored-' + type, 'tree/sub/entry'), 'utf8'), 'sync-marker'));
  }
  return dir;
}
async function configurationAndMonitoring(cycle, dir) {
  for (const type of ['overview', 'cpu', 'memory', 'disk', 'network', 'process']) await must('monitor-' + type, 'ssh_monitor', { server, type });
  await must('health-real-metrics', 'ssh_health_check', { server }, value => assert(value.samples.length > 0));
  await must('service-status-existing-service', 'ssh_service_status', { server, services: [windows ? 'Schedule' : 'cron'] });
  await check('service-status-nonexistent', 'ssh_service_status', { server, services: ['relay-ai-deliberately-missing'] }, windows);
  for (const sortBy of ['cpu', 'memory']) await must('process-list-' + sortBy, 'ssh_process_manager', { server, action: 'list', sortBy, limit: 10 });
  await must('process-info-owned-process', 'ssh_process_manager', { server, action: 'info', pid: process.pid });
  const child = cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); clients.add(child);
  await must('process-kill-owned-process', 'ssh_process_manager', { server, action: 'kill', pid: child.pid, signal: 'TERM' });
  await untilState(() => child.exitCode !== null || child.signalCode !== null, Boolean, 10); clients.delete(child);
  const log = path.join(dir, 'tail.log'); fs.writeFileSync(log, 'first\nsecond\n');
  await must('tail-snapshot', 'ssh_tail', { server, file: log, follow: false, lines: 1 });
  const timer = setTimeout(() => fs.appendFileSync(log, 'follow-marker\n'), 1500);
  try { await must('tail-bounded-follow', 'ssh_tail', { server, file: log, follow: true, lines: 1 }); } finally { clearTimeout(timer); }
  await must('alerts-set', 'ssh_alert_setup', { server, action: 'set', cpuThreshold: 100, memoryThreshold: 100, diskThreshold: 100, enabled: false });
  for (const action of ['get', 'check']) await must('alerts-' + action, 'ssh_alert_setup', { server, action });
  for (const action of ['list', 'status', 'enable', 'disable']) await must('hooks-' + action, 'ssh_hooks', { action, hook: 'on-error' });
  for (const action of ['list', 'current']) await must('profile-' + action, 'ssh_profile', { action });
  for (const profile of ['windows', 'default']) await must('profile-switch-' + profile, 'ssh_profile', { action: 'switch', profile });
  await must('alias-add', 'ssh_alias', { action: 'add', alias: 'ai-alias', server });
  await must('alias-list', 'ssh_alias', { action: 'list' });
  await must('alias-execute-resolves-correct-target', 'ssh_execute', { server: 'ai-alias', command: echo('alias-marker') }, value => assert.equal(value.stdout, 'alias-marker'));
  await must('alias-remove', 'ssh_alias', { action: 'remove', alias: 'ai-alias' });
  await must('command-alias-add', 'ssh_command_alias', { action: 'add', alias: 'ai-command', command: echo('command-alias-marker') });
  for (const action of ['list', 'suggest']) await must('command-alias-' + action, 'ssh_command_alias', { action, command: 'ai-command' });
  await must('command-alias-execute', 'ssh_execute', { server, command: 'ai-command' }, value => assert.equal(value.stdout, 'command-alias-marker'));
  await must('command-alias-remove', 'ssh_command_alias', { action: 'remove', alias: 'ai-command' });
  await must('group-create', 'ssh_group_manage', { action: 'create', name: 'ai-group', servers: [server] });
  await must('group-list', 'ssh_group_manage', { action: 'list' });
  await must('group-update', 'ssh_group_manage', { action: 'update', name: 'ai-group', description: 'owned fixture' });
  await must('group-remove-member', 'ssh_group_manage', { action: 'remove-servers', name: 'ai-group', servers: [server] });
  await must('group-add-member', 'ssh_group_manage', { action: 'add-servers', name: 'ai-group', servers: [server] });
  for (const strategy of ['parallel', 'sequential', 'rolling']) await must('group-execute-' + strategy, 'ssh_execute_group', { group: 'ai-group', command: echo('group-marker'), strategy, delay: 0 });
  await must('group-delete', 'ssh_group_manage', { action: 'delete', name: 'ai-group' });
  for (const action of ['list', 'verify', 'check']) await must('key-' + action, 'ssh_key_manage', { server, action });
  await must('key-remove', 'ssh_key_manage', { server, action: 'remove' });
  await check('revoked-key-refuses-execution', 'ssh_execute', { server, command: echo('must-not-execute') }, true);
  await must('key-accept-original-pin', 'ssh_key_manage', { server, action: 'accept' });
  await must('sudo-existing-authorized-token', 'ssh_execute_sudo', { server, command: windows ? echo('sudo-marker') : 'id -u' }, value => assert.equal(value.stdout.trim(), windows ? 'sudo-marker' : '0'));
  await must('history', 'ssh_history', {});
  const listener = net.createServer(socket => { socket.on('error', () => {}); socket.pipe(socket); }); listeners.add(listener);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  for (const type of ['local', 'remote', 'dynamic']) {
    const port = await freePort();
    const tunnel = await must('tunnel-create-' + type, 'ssh_tunnel_create', { server, type, localPort: type === 'remote' ? listener.address().port : port, remoteHost: '127.0.0.1', remotePort: type === 'remote' ? port : listener.address().port });
    await probeTunnel(port, listener.address().port, type === 'dynamic');
    await must('tunnel-list-' + type, 'ssh_tunnel_list', {});
    await must('tunnel-close-' + type, 'ssh_tunnel_close', { tunnelId: tunnel.id });
  }
  await new Promise(resolve => listener.close(resolve)); listeners.delete(listener);
  for (const action of ['status', 'cleanup']) await must('connection-' + action, 'ssh_connection_status', { server, action });
  await must('operations-list', 'ssh_operation_status', { server, limit: 100 });
}
const databases = process.env.RELAY_AI_DATABASES ? JSON.parse(fs.readFileSync(process.env.RELAY_AI_DATABASES)) : null;
function resetDatabase(type, config) {
  if (type === 'postgresql') native(['psql', '-h', '127.0.0.1', '-p', config.dbPort, '-U', config.dbUser, '-d', 'relay_ai', '-c', 'DROP TABLE IF EXISTS ai_probe']);
  else if (type === 'mysql') native(['mysql', '--no-defaults', '-h', '127.0.0.1', '-P', config.dbPort, '-u', config.dbUser, '-e', 'DROP TABLE IF EXISTS relay_ai.ai_probe']);
  else native(['mongosh', '--quiet', 'mongodb://127.0.0.1:' + config.dbPort + '/relay_ai', '--eval', 'db.ai_probe.drop()']);
}
async function databaseOperations(cycle, dir) {
  assert(databases, 'Real database fixtures are required; missing clients are not a successful capability test');
  for (const type of ['postgresql', 'mysql', 'mongodb']) {
    const config = databases[type], common = { server, type, database: 'relay_ai', dbHost: '127.0.0.1', ...config };
    const query = type === 'mongodb' ? { collection: 'ai_probe', query: '{}' } : { query: 'SELECT value FROM ai_probe' };
    const verify = value => assert(value.output.includes('ai-database-marker'), type + ' lost the seeded data');
    await must('database-query-' + type, 'ssh_db_query', { ...common, ...query }, verify);
    await must('database-list-' + type, 'ssh_db_list', common, value => assert(value.output.includes('ai_probe')));
    const outputFile = path.join(dir, type + '.dump.gz');
    await must('database-dump-' + type, 'ssh_db_dump', { ...common, outputFile }, value => assert(fs.statSync(outputFile).size > 0 && value.bytes > 0));
    resetDatabase(type, config);
    await must('database-import-into-empty-state-' + type, 'ssh_db_import', { ...common, inputFile: outputFile });
    await must('database-verify-restored-data-' + type, 'ssh_db_query', { ...common, ...query }, verify);
    await check('database-reject-mutation-query-' + type, 'ssh_db_query', { ...common, ...(type === 'mongodb' ? { collection: 'ai_probe', query: '{"$where":"true"}' } : { query: 'DROP TABLE ai_probe' }) }, true);
    const backupDir = path.join(dir, 'database-backups-' + type);
    const backup = await must('database-backup-create-' + type, 'ssh_backup_create', { ...common, name: 'ai', backupDir });
    await must('database-backup-list-' + type, 'ssh_backup_list', { server, type, backupDir });
    resetDatabase(type, config);
    await must('database-backup-restore-' + type, 'ssh_backup_restore', { server, database: 'relay_ai', dbHost: '127.0.0.1', ...config, backupId: backup.backup.id, backupDir });
    await must('database-verify-backup-restored-data-' + type, 'ssh_db_query', { ...common, ...query }, verify);
  }
}
async function realSchedules(dir) {
  for (const type of ['files', 'postgresql', 'mysql', 'mongodb']) {
    const name = 'ai_' + type + '_' + crypto.randomBytes(4).toString('hex');
    const before = Date.now(), backupDir = path.join(os.homedir(), '.relay-mcp', 'backups');
    const scheduled = await must('schedule-register-' + type, 'ssh_backup_schedule', { server, type, name, schedule: '* * * * *', ...(type === 'files' ? { paths: [path.join(dir, 'tree')] } : { database: 'relay_ai' }) });
    try {
      await untilState(async () => {
        if (!fs.existsSync(backupDir)) return false;
        return fs.readdirSync(backupDir).filter(file => file.endsWith('.meta.json')).some(file => {
          const meta = JSON.parse(fs.readFileSync(path.join(backupDir, file)));
          return meta.name === name && Date.parse(meta.createdAt) >= before && meta.bytes > 0;
        });
      }, Boolean, 100);
      rows.push({ label: 'schedule-actually-fired-' + type, tool: 'ssh_backup_schedule', type, passed: true }); save();
    } finally {
      if (windows) native(['schtasks.exe', '/Delete', '/TN', 'RelayMcp-' + name, '/F']);
      else {
        const current = native(['crontab', '-l']);
        native(['crontab', '-'], { input: current.split('\n').filter(line => !line.endsWith('# relay-mcp:' + name)).join('\n') + '\n' });
      }
      assert(scheduled.runner, 'Schedule must identify its generated runner');
    }
  }
  await check('schedule-reject-invalid-expression', 'ssh_backup_schedule', { server, type: 'files', name: 'invalid_ai_schedule', schedule: 'invalid', paths: [dir] }, true);
}
function nodeCommand(code) {
  const expression = "eval(Buffer.from(process.argv[1],'base64').toString())";
  return (windows ? '& ' : '') + quote(process.execPath) + ' -e ' + quote(expression) + ' ' + quote(Buffer.from(code).toString('base64'));
}
async function cancellationTimeoutAndRecovery(dir) {
  const timeout = await check('command-timeout-reports-real-failure', 'ssh_execute', { server, command: nodeCommand('setInterval(()=>{},1000)'), timeout: 1500 }, true);
  assert(timeout?.operationId, 'Timeout must retain original operation ID');
  await must('query-timed-out-original-operation', 'ssh_operation_status', { operationId: timeout.operationId }, value => assert.equal(value.errorCode, 'EXEC_TIMEOUT'));
  const file = path.join(dir, 'cancel-once');
  const pending = check('cancelled-command-does-not-complete-successfully', 'ssh_execute', { server, command: nodeCommand('require("fs").appendFileSync(' + JSON.stringify(file) + ',"once");setInterval(()=>{},1000)'), timeout: 60000 }, true);
  await untilState(() => fs.existsSync(file), Boolean);
  const operation = await untilState(async () => {
    const response = await client.callTool({ name: 'ssh_operation_status', arguments: { server, limit: 100 } });
    const value = JSON.parse(response.content[0].text);
    return value.operations.find(record => record.kind === 'exec' && !['completed', 'failed', 'cancelled'].includes(record.state));
  }, Boolean);
  await must('cancel-owned-operation', 'ssh_operation_status', { operationId: operation.operationId, action: 'cancel', requestId: crypto.randomUUID() });
  await pending;
  await untilState(async () => {
    const r = await client.callTool({ name: 'ssh_operation_status', arguments: { operationId: operation.operationId } });
    return JSON.parse(r.content[0].text);
  }, value => value.state === 'cancelled');
  assert.equal(fs.readFileSync(file, 'utf8'), 'once');
  // A lost MCP process must not replay a submitted side effect.
  const recoveryFile = path.join(dir, 'recover-once');
  const unobserved = client.callTool({ name: 'ssh_execute', arguments: { server, command: nodeCommand('require("fs").appendFileSync(' + JSON.stringify(recoveryFile) + ',"once");setTimeout(()=>{},10000)'), timeout: 60000 } }).catch(() => null);
  await untilState(() => fs.existsSync(recoveryFile), Boolean);
  const saved = await client.callTool({ name: 'ssh_operation_status', arguments: { server, limit: 100 } });
  const original = JSON.parse(saved.content[0].text).operations.find(record => record.kind === 'exec' && !['completed', 'failed', 'cancelled'].includes(record.state));
  assert(original);
  await client.close(); await unobserved; await mcpStart();
  await untilState(async () => {
    const r = await client.callTool({ name: 'ssh_operation_status', arguments: { operationId: original.operationId } }); return JSON.parse(r.content[0].text);
  }, value => value.state === 'completed');
  await must('MCP-restart-queries-without-replaying-side-effect', 'ssh_operation_status', { operationId: original.operationId }, () => assert.equal(fs.readFileSync(recoveryFile, 'utf8'), 'once'));
  await must('connection-explicit-disconnect', 'ssh_connection_status', { server, action: 'disconnect' });
  await must('connection-explicit-reconnect', 'ssh_connection_status', { server, action: 'reconnect' });
  const reconnect = await must('AI-connect-remembered-device', 'ssh_connect', { server, waitMs: 20000, requestId: crypto.randomUUID() });
  if (reconnect.connectionTaskId) await must('AI-query-existing-connection-task', 'ssh_connect', { connectionTaskId: reconnect.connectionTaskId });
}
function auditCoverage() {
  const exercised = new Set(rows.filter(row => row.passed).map(row => row.tool));
  const excluded = coreOnly ? ['ssh_db_dump', 'ssh_db_import', 'ssh_db_list', 'ssh_db_query', 'ssh_backup_schedule'] : [];
  const expected = tools.filter(tool => !excluded.includes(tool.name));
  summary.excludedTools = excluded;
  summary.missingTools = expected.filter(tool => !exercised.has(tool.name)).map(tool => tool.name);
  summary.missingActions = expected.flatMap(tool => (tool.inputSchema.properties?.action?.enum || []).filter(action => !rows.some(row => row.passed && row.tool === tool.name && row.action === action)).map(action => tool.name + ':' + action));
  assert.deepEqual(summary.missingTools, [], 'An advertised AI tool has not been exercised');
  assert.deepEqual(summary.missingActions, [], 'An advertised action has not been exercised');
  assert(rows.every(row => row.passed), 'One or more AI scenarios failed');
  summary.advertisedToolCount = tools.length; summary.checkedCases = rows.length; save();
}
function sourceHash() {
  const hash = crypto.createHash('sha256');
  const walk = dir => { for (const name of fs.readdirSync(path.join(repo, dir)).sort()) {
    const file = path.join(dir, name);
    if (fs.statSync(path.join(repo, file)).isDirectory()) walk(file);
    else { hash.update(file.split(path.sep).join('/')); hash.update(fs.readFileSync(path.join(repo, file))); }
  }}; for (const dir of ['src', 'desktop', 'launchers']) walk(dir); return hash.digest('hex');
}
try {
  summary.sourceHash = sourceHash(); save();
  if (windows) {
    const script = "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; & icacls.exe $env:RELAY_AI_NEW_FIXTURE /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F');exit $LASTEXITCODE";
    native(['powershell.exe', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, RELAY_AI_NEW_FIXTURE: root } });
  }
  far = new Agent({ role: 'far', dir: path.join(root, 'far'), allowCloudSelfTest: true });
  near = new Agent({ role: 'near', dir: nearDir, allowCloudSelfTest: true });
  const observe = entry => {
    if (measuring && ['worker_exited', 'connection_failed', 'mqtt_offline'].includes(entry.trace?.event || entry.event)) runtimeFailure ||= Error('Relay disconnected or restarted during AI hour');
  }; far.emit = observe; near.emit = observe;
  await far.start(); await near.start();
  fs.writeFileSync(path.join(nearDir, 'server-bindings.json'), JSON.stringify({ schemaVersion: 1, servers: { target: { deviceId: far.identity.deviceId } } }), { mode: 0o600 });
  await mcpStart(); tools = (await client.listTools()).tools; assert.equal(tools.length, 39);
  const prompts = (await client.listPrompts()).prompts; assert.equal(prompts.length, 5);
  for (const prompt of prompts) { const value = await client.getPrompt({ name: prompt.name, arguments: { server, task: 'owned acceptance fixture' } }); assert(value.messages.length > 0); }
  assert((await client.readResource({ uri: 'relay-mcp://guide' })).contents[0].text.includes('ssh_operation_status'));
  summary.promptsVerified = prompts.map(prompt => prompt.name); summary.guideVerified = true;
  const offer = await request(path.join(root, 'far'), '/pair/create', {});
  const connect = await must('AI-pair-new-device', 'ssh_connect', { code: offer.code, waitMs: 20000, requestId: crypto.randomUUID() });
  if (connect.connectionTaskId) await untilState(() => must('AI-poll-pairing-task', 'ssh_connect', { connectionTaskId: connect.connectionTaskId }), value => value.state === 'ready', 180);
  await untilState(() => near.status().devices[0], value => value?.state === 'online', 180);
  let dir;
  const group = async (name, fn) => { try { await fn(); } catch (error) {
    rows.push({ label: name, passed: false, error: error.message.slice(0, 700) }); save();
  }};
  await group('command-files-sessions-deploy-backup', async () => { dir = await basicAndFiles(0); });
  if (!dir) { dir = path.join(root, 'independent-checks'); fs.mkdirSync(path.join(dir, 'tree'), { recursive: true }); fs.writeFileSync(path.join(dir, 'tree/entry'), 'independent fixture'); }
  await group('configuration-monitoring-tunnels-permissions', () => configurationAndMonitoring(0, dir));
  await group('cancellation-timeout-MCP-restart-and-reconnect', () => cancellationTimeoutAndRecovery(dir));
  if (!coreOnly) {
    await group('real-database-roundtrips', () => databaseOperations(0, dir));
    await group('real-scheduler-trigger', () => realSchedules(dir));
  }
  auditCoverage();
  hourStart = performance.now(); measuring = true; summary.hourStartedAtUtc = new Date().toISOString();
  const baseline = { near: { ...near.stats }, far: { ...far.stats } }; summary.hourCycles = 0;
  while (performance.now() - hourStart < requiredSeconds * 1000) {
    if (runtimeFailure) throw runtimeFailure;
    assert.equal(near.status().devices[0]?.state, 'online');
    for (const [agent, before] of [[near, baseline.near], [far, baseline.far]]) {
      assert.equal(agent.stats.workerRestarts, before.workerRestarts); assert.equal(agent.stats.disconnects, before.disconnects);
    }
    const cycleDir = await basicAndFiles(++ticks);
    await configurationAndMonitoring(ticks, cycleDir); await databaseOperations(ticks, cycleDir);
    if (runtimeFailure) throw runtimeFailure;
    summary.hourCycles++; summary.hourElapsedSeconds = (performance.now() - hourStart) / 1000; save();
    console.log('AI HOUR', Math.floor(summary.hourElapsedSeconds), 'seconds;', summary.hourCycles, 'complete operation cycles');
    await pause(1000);
  }
  summary.hourElapsedSeconds = (performance.now() - hourStart) / 1000;
  assert(summary.hourElapsedSeconds >= requiredSeconds); assert.equal(sourceHash(), summary.sourceHash); auditCoverage(); summary.passed = true;
} catch (error) {
  summary.failure = error.message.slice(0, 1000); process.exitCode = 1; console.error('ALL AI FAILED', summary.failure);
} finally {
  measuring = false; summary.finishedAtUtc = new Date().toISOString(); save();
  console.log('ALL AI RESULT', JSON.stringify({ passed: summary.passed, cases: rows.length, cycles: summary.hourCycles, failure: summary.failure }));
  for (const child of clients) child.kill();
  for (const listener of listeners) listener.close();
  await client?.close().catch(() => {}); await Promise.allSettled([near?.close(), far?.close()]);
}
