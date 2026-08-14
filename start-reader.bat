@echo off
REM Paper Reader - 一键启动 (kill stale first + start + health-check + open)
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
title PaperReader 启动
set "READER_DIR=%~dp0"
set "PY=C:\Users\z3450390\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" set "PY=python"

cd /d "%READER_DIR%"

echo ============================================
echo    Paper Reader 启动
echo ============================================
echo.

echo [1/4] 关闭占用 8731 端口的旧进程（含休眠后卡死的进程）...
powershell -NoProfile -Command "$pids = (Get-NetTCPConnection -LocalPort 8731 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique; if ($pids) { $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host ('  结束 PID ' + $_) } } else { Write-Host '  无旧进程，端口空闲' }"
timeout /t 2 >nul

echo [2/4] 启动服务器...
start "PaperReader-Server" "%PY%" server.py
timeout /t 2 >nul

echo [3/4] 健康检查（确认服务器真的在响应）...
set "OK=0"
for /L %%i in (1,1,12) do (
  for /f "tokens=*" %%c in ('curl -4 -s -o nul -w "%%{http_code}" http://127.0.0.1:8731/reader.html') do (
    if "%%c"=="200" (
      set "OK=1"
      goto :healthy
    )
  )
  timeout /t 1 >nul
)
:healthy
if "%OK%"=="1" (
  echo   服务器已正常响应 (HTTP 200)，可以打开。
) else (
  echo   [警告] 服务器进程已启动，但未返回 HTTP 200。
  echo   请查看名为 "PaperReader-Server" 的控制台窗口，里面应有报错信息。
)

echo [4/4] 打开浏览器...
start "" http://localhost:8731/

echo.
echo 完成！浏览器应已打开阅读器。
echo 关闭 "PaperReader-Server" 窗口即可停止服务。
echo.
pause >nul
