@echo off
REM ==============================
REM PiFlea Market — Push to GitHub
REM ==============================
REM 用法：双击运行，或在终端执行

echo 正在推送到 GitHub...

git add -A
git commit -m "ci: add GitHub Actions deploy workflow"
git push origin main

echo.
echo ✅ 推送完成！
echo.
echo 然后去 GitHub 仓库页面 →
echo Settings → Pages → Source 选 "GitHub Actions"
echo GitHub Actions 会自动构建部署。
pause
