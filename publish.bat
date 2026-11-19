@echo off
chcp 65001 >nul
echo 正在发布文章到 GitHub...

:: 添加所有更改
git add .

:: 获取当前时间作为提交信息
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "timestamp=%YYYY%-%MM%-%DD% %HH%:%Min%:%Sec%"

:: 提交更改
git commit -m "发布文章 %timestamp%"

:: 推送到 GitHub
git push origin main

echo.
echo 发布完成！
echo GitHub Actions 将自动构建和部署网站。
echo 请稍等片刻后访问 https://honors123456.github.io
pause
