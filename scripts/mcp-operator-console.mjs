// A JSON-lines MCP terminal. Each request is chosen by the operator, not a suite.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const dir = path.resolve(process.argv[2]);
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.resolve('src/mcp.cjs'), '--agent-dir', dir, '--state-dir', path.join(dir, 'mcp')], stderr: 'pipe', env: { ...process.env } });
transport.stderr.on('data', data => fs.appendFileSync(path.join(dir, 'mcp-private.log'), data, { mode: 0o600 }));
const client = new Client({ name: 'direct-ai-operator', version: '1' }); await client.connect(transport);
console.log(JSON.stringify({ ready: true }));
function output(value) {
  fs.appendFileSync(path.join(dir, 'operator-private-results.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(value));
}
async function handle(line) {
  try {
    const input = JSON.parse(line), params = input.params || {}; let result;
    if (input.method === 'tools/call') {
      if (params.arguments?.privateArgsFile) {
        const { privateArgsFile, ...args } = params.arguments;
        params.arguments = { ...args, ...JSON.parse(fs.readFileSync(privateArgsFile)) };
      }
      if (params.name === 'ssh_connect' && params.arguments?.codeFile) {
        const { codeFile, ...args } = params.arguments;
        params.arguments = { ...args, code: JSON.parse(fs.readFileSync(codeFile)).code };
      }
      result = await client.callTool(params, undefined, { timeout: 330000 });
    } else if (input.method === 'tools/list') result = await client.listTools();
    else if (input.method === 'prompts/list') result = await client.listPrompts();
    else if (input.method === 'prompts/get') result = await client.getPrompt(params);
    else if (input.method === 'resources/read') result = await client.readResource(params);
    else throw Error('Use an MCP tools, prompts or resource method');
    output({ id: input.id, method: input.method, tool: params.name, result });
  } catch (error) { output({ error: error.message }); }
}
const pending = new Set();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const work = handle(line); pending.add(work); work.finally(() => pending.delete(work));
}
await Promise.allSettled(pending);
await client.close();
