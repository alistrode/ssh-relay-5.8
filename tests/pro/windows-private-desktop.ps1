param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Arguments,[string]$WorkingDirectory,[int]$TimeoutSeconds=180)
$ErrorActionPreference='Stop'
# A fixture-only desktop. Never switches or sends input to the shared desktop.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RelayTestDesktop {
 [StructLayout(LayoutKind.Sequential)] public struct SA { public int length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct SI { public int cb; public string reserved; public string desktop; public string title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,cbReserved; public IntPtr reserved2,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr process,thread; public int pid,tid; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr OpenDesktopW(string name,int flags,bool inherit,int access);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,int flags,int access,ref SA security);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("advapi32.dll",SetLastError=true)] public static extern uint GetSecurityInfo(IntPtr handle,int kind,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr memory);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool CreateProcessW(string exe,System.Text.StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,int flags,IntPtr environment,string cwd,ref SI startup,out PI process);
 [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,int milliseconds);
 [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$default=[RelayTestDesktop]::OpenDesktopW('Default',0,$false,0x20000)
if($default -eq [IntPtr]::Zero){throw 'Cannot read this session default desktop security'}
$owner=$group=$dacl=$sacl=$descriptor=[IntPtr]::Zero
$desktop=[IntPtr]::Zero;$process=New-Object RelayTestDesktop+PI
try {
 $securityResult=[RelayTestDesktop]::GetSecurityInfo($default,7,0x14,[ref]$owner,[ref]$group,[ref]$dacl,[ref]$sacl,[ref]$descriptor)
 if($securityResult -ne 0){throw ('Cannot copy default desktop security: '+$securityResult)}
 $security=New-Object RelayTestDesktop+SA;$security.length=[Runtime.InteropServices.Marshal]::SizeOf($security);$security.descriptor=$descriptor
 $name='SSHRelayProTest_'+[Guid]::NewGuid().ToString('N')
 $desktop=[RelayTestDesktop]::CreateDesktopW($name,[IntPtr]::Zero,[IntPtr]::Zero,0,0xF01FF,[ref]$security)
 if($desktop -eq [IntPtr]::Zero){throw ('Private desktop creation failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
 $startup=New-Object RelayTestDesktop+SI;$startup.cb=[Runtime.InteropServices.Marshal]::SizeOf($startup);$startup.desktop='WinSta0'+[char]92+$name
 $exe=(Get-Item -LiteralPath $Executable).FullName
 if(!$WorkingDirectory){$WorkingDirectory=Split-Path $exe -Parent}
 $command=New-Object Text.StringBuilder(('"'+$exe+'" '+$Arguments))
 if(![RelayTestDesktop]::CreateProcessW($exe,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08000000,[IntPtr]::Zero,$WorkingDirectory,[ref]$startup,[ref]$process)){throw ('Private desktop child failed: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
 $wait=[RelayTestDesktop]::WaitForSingleObject($process.process,$TimeoutSeconds*1000)
 if($wait -ne 0){ & taskkill.exe /PID $process.pid /T /F | Out-Null; throw 'Private desktop test timed out' }
 $code=[uint32]0;[RelayTestDesktop]::GetExitCodeProcess($process.process,[ref]$code) | Out-Null
 [pscustomobject]@{privateDesktop=$true;switchedInputDesktop=$false;exitCode=$code;pid=$process.pid} | ConvertTo-Json -Compress
 exit $code
} finally {
 if($process.thread -ne [IntPtr]::Zero){[RelayTestDesktop]::CloseHandle($process.thread) | Out-Null}
 if($process.process -ne [IntPtr]::Zero){[RelayTestDesktop]::CloseHandle($process.process) | Out-Null}
 if($desktop -ne [IntPtr]::Zero){[RelayTestDesktop]::CloseDesktop($desktop) | Out-Null}
 if($descriptor -ne [IntPtr]::Zero){[RelayTestDesktop]::LocalFree($descriptor) | Out-Null}
 [RelayTestDesktop]::CloseDesktop($default) | Out-Null
}
