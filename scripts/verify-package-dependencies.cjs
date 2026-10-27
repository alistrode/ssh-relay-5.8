"use strict";
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const app=path.resolve(process.argv[2]||'');
if(!fs.existsSync(path.join(app,'package.json')))throw Error('Supply the packaged application directory');
const requireApp=createRequire(path.join(app,'package.json'));
for(const entry of ['@modelcontextprotocol/sdk/server/mcp.js','@modelcontextprotocol/sdk/client/index.js','@serenity-kit/opaque','https-proxy-agent','mqtt','ssh2','zod']){
 const file=fs.realpathSync(requireApp.resolve(entry));
 if(!file.startsWith(app+path.sep+'node_modules'+path.sep))throw Error('Production dependency escaped package: '+entry);
}
console.log('Production entrypoints resolve inside the package');
