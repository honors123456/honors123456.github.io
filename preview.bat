@echo off
setlocal
pushd "%~dp0" || exit /b 1
set "HUGO_EXE=.tools\hugo\hugo.exe"
if not exist "%HUGO_EXE%" set "HUGO_EXE=hugo.exe"
"%HUGO_EXE%" server --buildDrafts --buildFuture --openBrowser --bind 127.0.0.1 --renderToMemory --noBuildLock --cacheDir "%~dp0.tools\hugo\cache" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" (
    echo Hugo could not start. Check the error above and see README.md.
    pause
)
exit /b %EXIT_CODE%
