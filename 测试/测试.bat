@echo off
chcp 65001 >nul
echo ================================================================================
echo                           上下文API测试服务器
echo ================================================================================
echo.
echo 正在启动测试服务器（端口5555）...
echo 测试服务器将调用主服务器（端口2333）的上下文API
echo.
echo 测试端点:
echo   - http://localhost:5555/test - 测试获取上下文
echo   - http://localhost:5555/test-info - 测试上下文信息
echo   - http://localhost:5555/ - 测试页面（浏览器访问）
echo.
echo 按 Ctrl+C 停止服务器
echo.
echo ================================================================================
echo.

cd /d "%~dp0"
node test_server.js

pause

