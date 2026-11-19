@echo off
setlocal
set "SCRIPT=%~dp0scripts\publish.ps1"
if not exist "%SCRIPT%" (
    echo Missing scripts\publish.ps1
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%