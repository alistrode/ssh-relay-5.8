"use strict";
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const files = fs.readdirSync(__dirname).filter(name => name !== path.basename(__filename) && /\.(cjs|mjs)$/.test(name) && fs.readFileSync(path.join(__dirname, name), 'utf8').includes('node:test')).map(name => path.join(__dirname, name));
console.log('Running', files.length, 'test files; skips remain visible in the native report');
const result = cp.spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...files], { stdio: 'inherit', env: { ...process.env, SSH_RELAY_NATIVE_ACCEPTANCE: '1' } });
process.exit(result.status ?? 1);
