$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$profile='C:\Users\Acer\.ssh-relay-pro-5.7-isolated';$r='E:\xxm\ssh-relay-5.7-isolated';$state=Get-Content "$profile\client-runtime.json" -Raw|ConvertFrom-Json
$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($state.clientPid)";if(!$p -or $p.ExecutablePath -ne "$r\release\SSHRelayPro.exe" -or !$p.CommandLine.Contains($profile)){throw '5.7 GUI ownership mismatch'}
$reply=Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/tray-exit" -Method Post -Headers @{Authorization=('Bearer '+$state.token)} -ContentType 'application/json' -Body (@{pid=$state.clientPid}|ConvertTo-Json -Compress) -TimeoutSec 60
if(!$reply.backendsStopped){throw '5.7 backend stop not confirmed'}
Stop-Process -Id $state.clientPid -Force
for($i=0;$i -lt 30;$i++){if(!(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 500}
if(Get-Process -Id $state.pid -ErrorAction SilentlyContinue){throw '5.7 supervisor still finishing; inspect before relaunch'}
Start-ScheduledTask -TaskName 'SSHRelay57-Isolated-Launch'
@{state='5.7-controlled-relaunch';previousGui=$state.clientPid}|ConvertTo-Json -Compress
