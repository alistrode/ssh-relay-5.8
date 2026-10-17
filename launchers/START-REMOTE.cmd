@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="--check" (
  "%~dp0runtime\node.exe" --version
  exit /b
)
if not "%~1"=="--no-desktop" "%~dp0runtime\node.exe" launchers\desktop.cjs
"%~dp0runtime\node.exe" src\start.cjs
set "relay_exit=%errorlevel%"
if not "%relay_exit%"=="0" (
  echo.
  echo Remote startup failed. Read the error above.
  pause
)
exit /b %relay_exit%
