// Thin operator terminal: each input is an individually chosen MCP request.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
const folder = path.resolve(process.argv[2]);
const app = path.join(folder, 'resources/app');
const sdk = path.join(app, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client');
const { Client } = await import(pathToFileURL(path.join(sdk, 'index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'stdio.js')));
const dir = path.resolve(process.argv[3]);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const transport = new StdioClientTransport({ command: path.join(folder, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
  args: [path.join(app, 'launchers/portable-entry.cjs'), '--mcp', '--state-dir', path.join(dir, 'mcp')], env: { ...process.env }, stderr: 'pipe' });
transport.stderr.on('data', data => fs.appendFileSync(path.join(dir, 'mcp-private.log'), data, { mode: 0o600 }));
const client = new Client({ name: 'downloaded-folder-operator', version: '1' });
await client.connect(transport);
console.log(JSON.stringify({ ready: true }));
async function handle(line) {
  try {
    const input = JSON.parse(line), params = input.params || {}; let result;
    if (params.arguments?.privateArgsFile) {
      const { privateArgsFile, ...args } = params.arguments;
      params.arguments = { ...args, ...JSON.parse(fs.readFileSync(privateArgsFile)) };
    }
    if (input.method === 'tools/call') result = await client.callTool(params, undefined, { timeout: 330000 });
    else if (input.method === 'tools/list') result = await client.listTools();
    else if (input.method === 'prompts/list') result = await client.listPrompts();
    else if (input.method === 'prompts/get') result = await client.getPrompt(params);
    else if (input.method === 'resources/read') result = await client.readResource(params);
    else throw Error('Use an MCP method');
    const output = { time: new Date().toISOString(), id: input.id, method: input.method, tool: params.name, result };
    fs.appendFileSync(path.join(dir, 'folder-private-results.jsonl'), JSON.stringify(output) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(output));
  } catch (error) { console.log(JSON.stringify({ error: error.message })); }
}
const pending = new Set();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const work = handle(line); pending.add(work); work.finally(() => pending.delete(work));
}
await Promise.allSettled(pending); await client.close();
