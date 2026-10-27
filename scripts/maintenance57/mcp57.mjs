import path from 'node:path';
import {fileURLToPath} from 'node:url';
const sourceRoot=process.env.RELAY_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {Client}=await import(path.join(sourceRoot,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
const {StdioClientTransport}=await import(path.join(sourceRoot,'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'));
import fs from 'node:fs';
const root=sourceRoot, dir=process.env.RELAY_AGENT;
if(!dir)throw Error('Set RELAY_AGENT explicitly');
const client=new Client({name:'version-isolation-operator',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'/src/mcp.cjs','--agent-dir',dir,'--state-dir',dir+'/mcp'],stderr:'inherit'}));
try { const args=JSON.parse(fs.readFileSync(0,'utf8')); const result=await client.callTool({name:args.name,arguments:args.arguments||{}},undefined,{timeout:360000});if(process.env.RESULT_FILE)fs.writeFileSync(process.env.RESULT_FILE,JSON.stringify(result,null,2));console.log(JSON.stringify(result)); } finally {await client.close();}
