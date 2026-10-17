@echo off
setlocal
cd /d "%~dp0"
node src\start.cjs
if errorlevel 1 (
  echo.
  echo Remote startup failed. Read the error above and docs\PERMISSIONS.md.
  pause
  exit /b 1
)
