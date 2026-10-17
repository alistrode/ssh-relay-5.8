"use strict";
const os = require("node:os");
const { spawnSync } = require("node:child_process");
let cached;
const windowsProbe = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RelayTokenProbe {
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr token);
 [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr t, int cls, IntPtr data, int size, out int needed);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint n);
 static IntPtr Read(IntPtr token, int cls) {
  int n; GetTokenInformation(token, cls, IntPtr.Zero, 0, out n);
  if (n <= 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  IntPtr p=Marshal.AllocHGlobal(n);
  if (!GetTokenInformation(token, cls, p, n, out n)) { int e=Marshal.GetLastWin32Error(); Marshal.FreeHGlobal(p); throw new System.ComponentModel.Win32Exception(e); }
  return p;
 }
 public static int[] Inspect() {
  IntPtr t;
  if (!OpenProcessToken(GetCurrentProcess(), 8, out t)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  try {
   int[] result=new int[4];
   int[] classes={11,18,20,25};
   for(int i=0;i<classes.Length;i++) {
    IntPtr p=Read(t,classes[i]);
    try {
     if(classes[i]==25) { IntPtr sid=Marshal.ReadIntPtr(p); byte count=Marshal.ReadByte(GetSidSubAuthorityCount(sid)); result[i]=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1))); }
     else result[i]=Marshal.ReadInt32(p);
    } finally {Marshal.FreeHGlobal(p);}
   }
   return result;
  } finally {CloseHandle(t);}
 }
}
'@
$x=[RelayTokenProbe]::Inspect()
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
[pscustomobject]@{account=$identity.Name;sid=$identity.User.Value;restrictedSidCount=$x[0];elevationType=$x[1];elevated=($x[2] -ne 0);integrityRid=$x[3]} | ConvertTo-Json -Compress
`;
function inspectPermissions() {
 if (cached) return cached;
 const user=os.userInfo();
 const context={platform:process.platform,hostname:os.hostname(),account:user.username,home:user.homedir,pid:process.pid};
 if(process.platform==='win32') {
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsProbe,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  if(result.error || result.status!==0) throw new Error('Windows token inspection failed: '+(result.error ? result.error.message : result.stderr.trim()));
  let token;
  try {token=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim());} catch {throw new Error('Windows token inspection returned invalid JSON');}
  if(!Number.isInteger(token.restrictedSidCount)||token.restrictedSidCount<0||!Number.isInteger(token.integrityRid)||typeof token.sid!=='string') throw new Error('Windows token inspection is incomplete');
  Object.assign(context,token);
 } else {
  Object.assign(context,{uid:user.uid,gid:user.gid,effectiveUid:process.geteuid?.(),effectiveGid:process.getegid?.(),groups:process.getgroups?.()});
 }
 cached=Object.freeze(context);return cached;
}
function requireUsableContext(context) {
 if(context.platform==='win32' && (context.restrictedSidCount>0 || context.integrityRid<8192)) {
  throw new Error('REMOTE_RESTRICTED_TOKEN: the remote inherited a restricted or low-integrity Windows token. Start it from an authorized normal desktop terminal with the intended account, then compare npm run permissions with local Codex. This process cannot grant itself a different token.');
 }
}
module.exports={inspectPermissions,requireUsableContext};
if(require.main===module) {
 try {console.log(JSON.stringify(inspectPermissions(),null,2));} catch(error) {console.error(error.message);process.exitCode=2;}
}
