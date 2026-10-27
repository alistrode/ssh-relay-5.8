$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$r='E:\xxm\ssh-relay-5.7-isolated';$env:ELECTRON_RUN_AS_NODE='1'
$code=@'
const fs=require('fs'),crypto=require('crypto'),path=require('path');const root='E:/xxm/ssh-relay-5.7-isolated';const meta=JSON.parse(fs.readFileSync(root+'/dev/final-package.json'));const mismatches=[];const entries=Object.entries(meta.sourceFilesSHA256);for(const [name,expected] of entries){const file=path.join(root,'release/resources/app',name);try{const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(actual!==expected)mismatches.push(name);}catch(error){mismatches.push(name+': '+error.code)}}console.log(JSON.stringify({sourceCommit:meta.sourceCommit,checked:entries.length,mismatches}));if(mismatches.length)process.exitCode=1;
'@
& "$r\release\SSHRelayPro.exe" -e $code
