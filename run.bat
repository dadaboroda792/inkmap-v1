@echo off
rem ============================================
rem  InkMap launcher. ASCII ONLY on purpose.
rem  Opens TWO windows: this one + SERVER window.
rem  Browser opens automatically when port is up.
rem ============================================
cd /d "%~dp0"
setlocal

set "MAP="
set /p "MAP=Map name (Enter = map list): "

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8123" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

start "SERVER InkMap - DO NOT CLOSE THIS WINDOW" cmd /k "python -m uvicorn server:app --host 127.0.0.1 --port 8123"

echo.
echo Waiting for server...
set /a TRY=0
:wait
timeout /t 1 /nobreak >nul
set /a TRY+=1
netstat -aon | findstr ":8123" | findstr "LISTENING" >nul && goto ready
if %TRY% lss 15 goto wait

echo.
echo SERVER DID NOT START in 15 s. Check the SERVER window for the reason.
pause
exit /b 1

:ready
echo Server is up! Opening browser...
if "%MAP%"=="" (
  start "" "http://127.0.0.1:8123/static/index.html"
) else (
  start "" "http://127.0.0.1:8123/static/map.html?map=%MAP%"
)
exit /b 0
