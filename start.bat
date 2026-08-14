@echo off
echo Starting TomiLite...

:: Kill existing node on our ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3091.*LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002.*LISTENING"') do taskkill /F /PID %%a 2>nul

:: Start API server
start "TomiLite-API" cmd /c "cd /d %~dp0 && npx tsx apps/api/src/server.ts"
echo    API: http://localhost:3091

:: Wait for API
timeout /t 3 /nobreak >nul

:: Start frontend
start "TomiLite-Web" cmd /c "cd /d %~dp0apps\web && npx vite --port 3002 --host 0.0.0.0"
echo    Web: http://localhost:3002

:: Wait for Vite
timeout /t 4 /nobreak >nul

:: Open in Chrome app mode (no URL bar, no tabs)
echo    Opening Chrome in app mode...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3002 --new-window

echo.
echo ✅ TomiLite is running in Chrome app mode.
echo    Close the two terminal windows and the Chrome window to stop.
