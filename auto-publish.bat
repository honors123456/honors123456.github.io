@echo off
chcp 65001 >nul
echo 启动自动发布监视...
echo 按 Ctrl+C 停止监视

:watch
timeout /t 30 >nul

:: 检查是否有更改
git status --porcelain >nul 2>&1
if %errorlevel% equ 0 (
    for /f %%i in ('git status --porcelain ^| find /c /v ""') do set count=%%i
    if !count! gtr 0 (
        echo 检测到更改，正在自动发布...
        git add .
        git commit -m "自动发布 %date% %time%"
        git push origin main
        echo 发布完成！
    )
)

goto watch
