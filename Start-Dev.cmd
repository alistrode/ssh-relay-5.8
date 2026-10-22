@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
 call npm ci --no-audit --no-fund
 if errorlevel 1 exit /b 1
)
set ELECTRON_RUN_AS_NODE=
call node_modules\.bin\electron.cmd . --no-shortcuts %*
