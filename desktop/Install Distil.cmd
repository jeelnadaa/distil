@echo off
rem Runs the installer past the script policy Windows sets by default, and keeps the window open.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
if errorlevel 1 (
  echo.
  echo Distil was not installed. The message above says why.
)
echo.
pause
