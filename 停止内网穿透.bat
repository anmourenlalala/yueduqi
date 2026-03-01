@echo off
REM ========================================
REM 停止 Cloudflared 隧道
REM ========================================

chcp 65001 >nul 2>&1
title 停止内网穿透
color 0C

echo ========================================
echo    正在停止 Cloudflared 隧道...
echo ========================================
echo.

tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I /N "cloudflared.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo 找到 cloudflared.exe 进程，正在终止...
    taskkill /F /IM cloudflared.exe >nul 2>&1
    if errorlevel 1 (
        echo [错误] 无法终止进程，可能需要管理员权限
    ) else (
        echo [✓] Cloudflared 隧道已停止
    )
) else (
    echo [信息] 未找到运行中的 cloudflared.exe 进程
)

echo.
echo ========================================
echo 操作完成
echo ========================================
echo.
pause
