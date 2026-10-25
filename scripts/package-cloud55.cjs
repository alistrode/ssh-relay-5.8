"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
if(process.platform!=="linux"||process.arch!=="x64")throw Error("Cloud package requires Linux x64");
const root=path.resolve(__dirname,".."),bundle=path.join(root,"run-output/SSHRelayPro-5.5-Cloud-Linux-x64"),release=path.join(bundle,"release"),app=path.join(release,"app");
fs.mkdirSync(app,{recursive:true});fs.mkdirSync(path.join(release,"runtime/bin"),{recursive:true});
fs.copyFileSync(process.execPath,path.join(release,"runtime/bin/node"));fs.chmodSync(path.join(release,"runtime/bin/node"),0o755);
fs.copyFileSync(path.resolve(process.execPath,"../../LICENSE"),path.join(release,"runtime/LICENSE"));
const filter=p=>!/(?:^|[\\/])(?:tests?|__tests__|benchmarks?|\.github)(?:[\\/]|$)/.test(p);
for(const name of ["src","assets","docs","profiles",".agents"]){if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(app,name),{recursive:true,filter});}
for(const name of ["package.json","package-lock.json","LICENSE.mcp-ssh-manager"])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(app,name));
fs.copyFileSync(path.join(root,"src/pro/client-lifecycle.cjs"),path.join(app,"src/pro/desktop-lifecycle.cjs"));
fs.copyFileSync(path.join(root,"cloud/client-lifecycle.cjs"),path.join(app,"src/pro/client-lifecycle.cjs"));
fs.writeFileSync(path.join(app,"CLOUD-ONLY.json"),JSON.stringify({edition:"cloud",release:"5.5",notice:"仅限云端下载使用",commit:process.env.GITHUB_SHA}));
fs.copyFileSync(path.join(root,"cloud/README.md"),path.join(bundle,"README.md"));fs.copyFileSync(path.join(root,"cloud/README.md"),path.join(app,"AGENTS.md"));
const modules=path.join(root,"node_modules"),dependencies=cp.execFileSync("npm",["ls","--omit=dev","--all","--parseable"],{cwd:root,encoding:"utf8"}).trim().split(/\r?\n/);
for(const source of dependencies){const relative=path.relative(modules,source);if(relative.startsWith("..")||path.isAbsolute(relative)||!relative)continue;fs.cpSync(source,path.join(app,"node_modules",relative),{recursive:true,filter});}
for(const dir of ["dev","backups"])fs.mkdirSync(path.join(bundle,dir),{recursive:true});
for(const [name,command] of Object.entries({"Start-Cloud.sh":'"$ROOT/release/app/src/pro/cloud.cjs" --profile-dir "$ROOT/dev/profile"',"Stop-Cloud.sh":'"$ROOT/release/app/src/pro/cloud.cjs" stop --profile-dir "$ROOT/dev/profile"',"relay-cli":'"$ROOT/release/app/src/pro/cli.cjs"',"mcp":'"$ROOT/release/app/src/mcp.cjs" --agent-dir "$ROOT/dev/profile/near" --state-dir "$ROOT/dev/mcp"'})){
  const file=path.join(bundle,name),cli=name==="relay-cli";
  fs.writeFileSync(file,'#!/bin/sh\n# 仅限云端下载使用\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'+(cli?'role=near\nprevious=\nfor argument in "$@"; do if [ "$previous" = "--role" ]; then role=$argument; fi; previous=$argument; done\ncase "$role" in near|far) ;; *) echo "Invalid role" >&2; exit 1;; esac\n':'')+'exec "$ROOT/release/runtime/bin/node" '+command+' "$@"'+(cli?' --state-dir "$ROOT/dev/profile/$role"':'')+'\n');fs.chmodSync(file,0o755);
}
console.log(bundle);
