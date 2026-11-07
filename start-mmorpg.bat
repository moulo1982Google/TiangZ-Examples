@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto failed

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd was not found. Install Node.js 24 and ensure npm is in PATH.
  goto failed
)

set "TIANGZ_WATCHER_CONTROL=stdin"
echo Starting the MMORPG server. Enter shutdown and press Enter to stop it.
call npm.cmd run start -- --package mmorpg
if errorlevel 1 goto failed
exit /b 0

:failed
echo MMORPG server could not start. Check the error above.
echo If the server has not been built or the host changed, run:
echo npm.cmd run build -- --package mmorpg
pause
exit /b 1
