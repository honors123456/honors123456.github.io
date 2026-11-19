@echo off
chcp 65001 >nul
echo 快速发布到 GitHub...

git add .
git commit -m "更新内容"
git push origin main

echo.
echo 完成！网站将在几分钟内更新。
timeout /t 3 >nul
