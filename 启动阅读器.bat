@echo off
REM ========================================
REM 多模阅读器启动器 - 英文版（避免编码问题）
REM ========================================

chcp 65001 >nul 2>&1
title Multi-Reader Launcher
color 0A

cd /d "%~dp0"

echo ========================================
echo      Multi-Reader Starting...
echo ========================================
echo.

echo Working directory: %cd%
echo Current user: %USERNAME%
echo.

REM Check Node.js
echo [1/3] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo Please install from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo OK - Node.js found
echo.

REM Check server.js
echo [2/3] Checking server.js...
if not exist "server.js" (
    echo [ERROR] server.js not found
    echo.
    pause
    exit /b 1
)
echo OK - server.js found
echo.

REM Check port
echo [3/3] Checking port 2333...
netstat -ano 2>nul | findstr ":2333 " >nul 2>&1
if not errorlevel 1 (
    echo [WARNING] Port 2333 might be in use
    echo Trying to release port...
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":2333 " 2^>nul') do (
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 1 /nobreak >nul 2>&1
    echo Port check completed
) else (
    echo OK - Port 2333 available
)
echo.

echo ========================================
echo [INFO] Starting server...
echo Server URL: http://localhost:2333
echo DO NOT close this window
echo Press Ctrl+C to stop server
echo ========================================
echo.

start "" http://localhost:2333
timeout /t 1 /nobreak >nul

echo Starting Node.js server...
echo.

node server.js

echo.
echo ========================================
if %errorlevel% equ 0 (
    echo Server stopped normally
) else (
    echo [ERROR] Server exit with code: %errorlevel%
    echo.
    echo Possible reasons:
    echo 1. Port 2333 is in use
    echo 2. Node modules not installed (run npm install)
    echo 3. Error in server.js
)
echo ========================================
echo.
echo Press any key to exit...
pause >nul