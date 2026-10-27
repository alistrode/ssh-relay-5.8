$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class Capture57Printed {
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
[void][Capture57Printed]::SetProcessDpiAwarenessContext([IntPtr](-4))
$exe='E:\xxm\ssh-relay-5.7-isolated\release\SSHRelayPro.exe'
$p=Get-Process SSHRelayPro|Where-Object {$_.Path -eq $exe -and $_.MainWindowHandle -ne 0}|Select-Object -First 1
if(!$p){throw 'No native 5.7 GUI window'}
[void][Capture57Printed]::ShowWindow($p.MainWindowHandle,9);[void][Capture57Printed]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 600
$r=[Capture57Printed+RECT]::new();if(![Capture57Printed]::GetWindowRect($p.MainWindowHandle,[ref]$r)){throw 'Window bounds unavailable'}
$w=$r.Right-$r.Left;$h=$r.Bottom-$r.Top
if($w -lt 400 -or $h -lt 300){throw 'Native window remains minimized'}
$bmp=[Drawing.Bitmap]::new($w,$h);$g=[Drawing.Graphics]::FromImage($bmp)
try{$dc=$g.GetHdc();try{if(![Capture57Printed]::PrintWindow($p.MainWindowHandle,$dc,2)){throw "Native PrintWindow failed"}}finally{$g.ReleaseHdc($dc)};$bmp.Save('E:\xxm\ssh-relay-5.7-isolated\dev\native57-private.png',[Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$bmp.Dispose()}
@{pid=$p.Id;title=$p.MainWindowTitle;width=$w;height=$h;captureMethod="PrintWindow";account=[Security.Principal.WindowsIdentity]::GetCurrent().Name}|ConvertTo-Json -Compress|Set-Content -Encoding UTF8 'E:\xxm\ssh-relay-5.7-isolated\dev\native57-meta.json'
