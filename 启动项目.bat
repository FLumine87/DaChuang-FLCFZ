@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_project.ps1"
echo.
echo Script finished. Press any key to close this window.
pause >nul