@echo off
REM Paper Reader - 一键修复 (kill stale servers on port 8731 + restart + open)
chcp 65001 >nul 2>&1
setlocal
title PaperReader 修复工具
set "READER_DIR=%~dp0"
set "PY=C:\Users\z3450390\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

cd /d "%READER_DIR%"

echo ============================================
echo    Paper Reader 一键修复
echo ============================================
echo.

echo [1/3] 关闭占用 8731 端口的旧进程...
powershell -NoProfile -Command "$pids = (Get-NetTCPConnection -LocalPort 8731 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host ('  结束 PID ' + $_) } } else { Write-Host '  无旧进程，端口空闲' }"
timeout /t 1 >nul

echo [2/3] 启动服务器...
start "PaperReader-Server" "%PY%" server.py
timeout /t 2 >nul

echo [3/3] 打开浏览器...
start "" http://localhost:8731/

echo.
echo 完成！浏览器应已打开阅读器。
echo 若仍打不开，请看 "PaperReader-Server" 窗口里有没有报错信息。
echo.
pause >nul
