@echo off
chcp 65001 >nul 2>&1
title Cloudflared 内网穿透
color 0B

cd /d "%~dp0"

if not exist "cloudflared.exe" (
    echo [错误] 未找到 cloudflared.exe
    pause
    exit /b 1
)

netstat -ano 2>nul | findstr ":2333 " >nul 2>&1
if errorlevel 1 (
    echo [警告] 端口 2333 未检测到服务运行
    echo 请先启动服务器
    pause
    exit /b 1
)

echo ========================================
echo    Cloudflared 内网穿透
echo ========================================
echo.
echo 📱 查找包含 trycloudflare.com 的行，那就是访问地址
echo.
echo ========================================
echo.

cloudflared.exe tunnel --url http://localhost:2333

pause
