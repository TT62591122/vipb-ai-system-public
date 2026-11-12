@echo off
chcp 65001 >nul
echo ============================================
echo   VIPB AI 外贸系统 - 启动中...
echo ============================================
echo.

cd /d D:\VIPB-AI-System

where pm2 >nul 2>&1
if %errorlevel%==0 (
    call pm2 start ecosystem.config.js
    echo.
    call pm2 list
) else (
    call "D:\ClawWindows\node_env\node-v24.13.0-win-x64\node-v24.13.0-win-x64\pm2.cmd" start ecosystem.config.js
    echo.
    call "D:\ClawWindows\node_env\node-v24.13.0-win-x64\node-v24.13.0-win-x64\pm2.cmd" list
)

echo.
echo ============================================
echo   系统已启动！
echo   访问地址: http://localhost:3001
echo ============================================
echo.
echo 按任意键关闭此窗口...
pause >nul