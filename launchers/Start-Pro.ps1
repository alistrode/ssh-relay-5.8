param([string]$ProfileDir = (Join-Path $env:USERPROFILE '.ssh-relay-pro-5.7'), [switch]$ExportOnly, [string]$RuntimeRoot = $env:SSH_RELAY_LAUNCH_ROOT)
$ErrorActionPreference = 'Stop'
if (!$RuntimeRoot) { $RuntimeRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent }
$appRoot = Join-Path $RuntimeRoot 'resources\app'
$executable = Join-Path $runtimeRoot 'SSHRelayPro.exe'
$logs = Join-Path $ProfileDir 'logs'
try { [IO.Directory]::CreateDirectory($logs) | Out-Null }
catch { $logs = Join-Path $env:USERPROFILE 'AppData\LocalLow\SSHRelayPro\logs'; [IO.Directory]::CreateDirectory($logs) | Out-Null }
$runId = [Guid]::NewGuid().ToString()
$launcherLog = Join-Path $logs 'launcher.jsonl'
function Record-Stage([string]$eventName, $exitCode = $null) {
  try {
    if ((Test-Path $launcherLog) -and (Get-Item $launcherLog).Length -ge 262144) {
      for ($i = 3; $i -ge 1; $i--) {
        $source = if ($i -eq 1) { $launcherLog } else { "$launcherLog.$($i - 1)" }
        if (Test-Path $source) { Move-Item -LiteralPath $source -Destination "$launcherLog.$i" -Force }
      }
    }
    $entry = @{ time=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); runId=$runId; event=$eventName }
    if ($null -ne $exitCode) { $entry.exitCode = $exitCode }
    [IO.File]::AppendAllText($launcherLog, (($entry | ConvertTo-Json -Compress) + "`n"), (New-Object Text.UTF8Encoding($false)))
  } catch { } # A logging failure must not prevent the application from starting.
}
Record-Stage 'launcher_enter'
if (!(Test-Path -LiteralPath $executable)) { Record-Stage 'runtime_missing'; throw 'Bundled runtime is missing. Extract the complete application folder again.' }
if (!$ExportOnly) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $groups = (& "$env:SystemRoot\System32\whoami.exe" /groups /fo csv /nh | Out-String)
  $integrity = [regex]::Match($groups, 'S-1-16-(\d+)')
  if (!$integrity.Success) { Record-Stage 'permission_check_failed'; throw 'Cannot verify the Windows startup token. Start from a normal desktop terminal.' }
  if ([int]$integrity.Groups[1].Value -lt 8192) {
    Record-Stage 'startup_permission_rejected'
    [Console]::Error.WriteLine('Windows supplied a low-integrity token. Open Start.cmd from a normal desktop terminal. No administrator access or security setting change is required.')
    exit 2
  }
}
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $executable
$start.WorkingDirectory = $runtimeRoot
$start.UseShellExecute = $false
$start.EnvironmentVariables['SSH_RELAY_RUN_ID'] = $runId
if ($ExportOnly) {
  $destination = Join-Path (Split-Path $logs -Parent) ('diagnostics-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.json.gz')
  $start.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $exporter = Join-Path $appRoot 'src\pro\gui-diagnostics.cjs'
  $start.Arguments = '"' + $exporter + '" "' + $logs + '" "' + $destination + '"'
} else {
  $start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
  $nativeLog = Join-Path $logs 'chromium.log'
  if (Test-Path $nativeLog) { Move-Item -LiteralPath $nativeLog -Destination ($nativeLog+'.previous') -Force }
  $start.Arguments = '--enable-logging=file --log-file="' + $nativeLog + '" --profile-dir "' + $ProfileDir + '"'
}
try {
  $child = [Diagnostics.Process]::Start($start)
  Record-Stage 'process_started'
  $child.WaitForExit()
  Record-Stage 'launcher_child_exit' $child.ExitCode
  if ($ExportOnly -and $child.ExitCode -eq 0) { Write-Output ('Diagnostics saved: ' + $destination) }
  exit $child.ExitCode
} catch { Record-Stage 'launcher_failed'; throw }
