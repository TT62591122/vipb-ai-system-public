@echo off
chcp 65001 >nul
echo ============================================
echo   VIPB AI 外贸系统 - 关闭中...
echo ============================================
echo.

where pm2 >nul 2>&1
if %errorlevel%==0 (
    call pm2 stop vipb-system
    call pm2 delete vipb-system
    echo.
    call pm2 list
) else (
    call "D:\ClawWindows\node_env\node-v24.13.0-win-x64\node-v24.13.0-win-x64\pm2.cmd" stop vipb-system
    call "D:\ClawWindows\node_env\node-v24.13.0-win-x64\node-v24.13.0-win-x64\pm2.cmd" delete vipb-system
    echo.
    call "D:\ClawWindows\node_env\node-v24.13.0-win-x64\node-v24.13.0-win-x64\pm2.cmd" list
)

echo.
echo ============================================
echo   系统已关闭！
echo ============================================
echo.
echo 按任意键关闭此窗口...
pause >nul