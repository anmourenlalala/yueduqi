@echo off
setlocal enabledelayedexpansion
REM ========================================
REM 局域网连接信息显示
REM ========================================

chcp 65001 >nul 2>&1
title 局域网连接信息
color 0B

cd /d "%~dp0"

echo ========================================
echo      局域网连接信息
echo ========================================
echo.

REM 获取本机IP地址
echo [正在获取本机IP地址...]
echo.

set "found=0"

REM 方法1: 使用ipconfig获取IPv4地址
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "ip=%%a"
    set "ip=!ip: =!"
    if not "!ip!"=="" (
        if "!ip:~0,3!" neq "169" (
            echo 本机IP地址: !ip!
            echo.
            echo ========================================
            echo 局域网访问地址:
            echo ========================================
            echo.
            echo 电脑端访问:
            echo   http://!ip!:2333
            echo.
            echo 手机端访问:
            echo   http://!ip!:2333
            echo.
            echo ========================================
            echo.
            echo 提示:
            echo 1. 确保手机和电脑在同一局域网
            echo 2. 确保防火墙允许2333端口
            echo 3. 确保服务器已启动（运行"启动阅读器.bat"）
            echo.
            echo ========================================
            set "found=1"
            goto :found
        )
    )
)

REM 方法2: 如果ipconfig失败，尝试其他方法
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IP Address"') do (
    set "ip=%%a"
    set "ip=!ip: =!"
    if not "!ip!"=="" (
        if "!ip:~0,3!" neq "169" (
            echo 本机IP地址: !ip!
            echo.
            echo ========================================
            echo 局域网访问地址:
            echo ========================================
            echo.
            echo 电脑端访问:
            echo   http://!ip!:2333
            echo.
            echo 手机端访问:
            echo   http://!ip!:2333
            echo.
            echo ========================================
            echo.
            echo 提示:
            echo 1. 确保手机和电脑在同一局域网
            echo 2. 确保防火墙允许2333端口
            echo 3. 确保服务器已启动（运行"启动阅读器.bat"）
            echo.
            echo ========================================
            set "found=1"
            goto :found
        )
    )
)

:found
if "!found!"=="0" (
    echo [警告] 无法自动获取IP地址
    echo 请手动查看IP地址:
    echo   1. 打开命令提示符
    echo   2. 输入: ipconfig
    echo   3. 查找"IPv4 地址"或"IP Address"
    echo   4. 使用该IP地址访问: http://[IP地址]:2333
    echo.
)

REM 检查服务器是否运行
echo [检查服务器状态...]
netstat -ano 2>nul | findstr ":2333 " >nul 2>&1
if not errorlevel 1 (
    echo [OK] 服务器正在运行 (端口2333)
) else (
    echo [提示] 服务器未运行
    echo 请先运行"启动阅读器.bat"启动服务器
)
echo.

REM 检查防火墙
echo [防火墙提示]
echo 如果无法访问，请检查Windows防火墙设置:
echo   1. 打开"Windows Defender 防火墙"
echo   2. 点击"高级设置"
echo   3. 添加入站规则，允许端口2333
echo   或者临时关闭防火墙测试
echo.

echo ========================================
echo.
echo 按任意键退出...
pause >nul

