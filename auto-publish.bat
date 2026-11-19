@echo off
setlocal
echo Watching for changes, press Ctrl+C to stop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish.ps1" -Watch %*
exit /b %ERRORLEVEL%