"use strict";
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
if(process.platform!=="win32")throw Error("Windows packaging requires Windows");
const root=path.resolve(__dirname,".."),out=path.join(root,"run-output"),bundle=path.join(out,"SSHRelayPro-5.5"),release=path.join(bundle,"release"),app=path.join(release,"resources","app");
fs.mkdirSync(bundle,{recursive:true});
fs.cpSync(path.join(root,"node_modules/electron/dist"),release,{recursive:true});
fs.renameSync(path.join(release,"electron.exe"),path.join(release,"SSHRelayPro.exe"));
fs.unlinkSync(path.join(release,"resources/default_app.asar"));
fs.mkdirSync(app,{recursive:true});
const filter=p=>!/(?:^|[\\/])(?:tests?|__tests__|benchmarks?|\.github)(?:[\\/]|$)/.test(p);
for(const name of ["src","desktop","assets","launchers","profiles","docs","examples",".agents"]){
  const source=path.join(root,name);if(fs.existsSync(source))fs.cpSync(source,path.join(app,name),{recursive:true,filter});
}
for(const name of ["package.json","package-lock.json","README.md","AGENTS.md","LICENSE.mcp-ssh-manager"]){
  if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(app,name));
}
const dependencies=cp.execFileSync("npm.cmd",["ls","--omit=dev","--all","--parseable"],{cwd:root,encoding:"utf8",shell:true}).trim().split(/\r?\n/);
const modules=path.join(root,"node_modules");
for(const source of dependencies){const relative=path.relative(modules,source);if(relative.startsWith("..")||path.isAbsolute(relative)||!relative)continue;fs.cpSync(source,path.join(app,"node_modules",relative),{recursive:true,filter});}
for(const dir of ["dev","backups"])fs.mkdirSync(path.join(bundle,dir));
const start='@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=\r\nstart "" "%~dp0release\\SSHRelayPro.exe" --profile-dir "%~dp0dev\\profile"\r\n';
fs.writeFileSync(path.join(bundle,"Start-5.5.cmd"),start);
fs.writeFileSync(path.join(bundle,"README.txt"),"SSH Relay Pro 5.5\r\n完整解压后双击 Start-5.5.cmd，无需安装 Node 或 npm。\r\n保留整个文件夹。仅连接 5.5，配置独立，不迁移旧版。\r\n关闭窗口收起到托盘，退出请用托盘菜单。\r\n运行环境：Windows 10/11 x64；Electron 44.8.0。\r\n第三方许可随运行环境和 resources/app/assets/licenses 提供。\r\n");
fs.writeFileSync(path.join(bundle,"BUILD.json"),JSON.stringify({version:"5.5.0",commit:process.env.GITHUB_SHA,platform:"win32-x64",electron:"44.8.0",privateStateIncluded:false},null,2));
console.log(bundle);
