@echo off
REM Paper Reader - 一键启动 (start server + open browser)
setlocal
set "READER_DIR=%~dp0"
set "PY=C:\Users\z3450390\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

cd /d "%READER_DIR%"

REM 若端口被占用则提示
start "PaperReader-Server" "%PY%" server.py

REM 等服务器起来再开浏览器
timeout /t 2 >nul
start "" http://localhost:8731/

echo Paper Reader 已启动。关闭 "PaperReader-Server" 窗口即可停止服务。
pause >nul
