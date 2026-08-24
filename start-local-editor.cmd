@echo off
setlocal
title Local HTML Slide Editor
cd /d "%~dp0"

where node.exe >nul 2>&1 || goto :missing_node
where corepack.cmd >nul 2>&1 || goto :missing_node

curl.exe --silent --fail --max-time 2 "http://127.0.0.1:4173/" >nul 2>&1
if not errorlevel 1 (
  echo The editor is already running. Opening the browser...
  start "" "http://127.0.0.1:4173"
  exit /b 0
)

echo Verifying pnpm 11.9.0 frozen-lock dependencies...
call corepack.cmd pnpm@11.9.0 install --frozen-lockfile || goto :error

echo Starting the editor...
echo If the browser is still loading, wait a few seconds and refresh it.
start "" "http://127.0.0.1:4173"
call corepack.cmd pnpm@11.9.0 run dev
if errorlevel 1 goto :error
exit /b 0

:missing_node
echo.
echo Node.js or Corepack was not found.
echo Install Node.js 20 or newer, then double-click this file again.
echo https://nodejs.org/
pause
exit /b 1

:error
echo.
echo Startup failed. Check the error message above.
echo If port 4173 or 4174 is already in use, close the previous editor window and try again.
pause
exit /b 1
