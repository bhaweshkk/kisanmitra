@echo off
REM KisanMitra Startup Script
REM This script ensures the server runs reliably

echo ========================================
echo    🌾 KisanMitra Server Startup
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if server.js exists
if not exist "server.js" (
    echo ❌ server.js not found in current directory
    pause
    exit /b 1
)

REM Kill any existing node processes on our ports
echo 🔄 Checking for port conflicts...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo Killing process %%a using port 3000
    taskkill /f /pid %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon ^| find ":3443" ^| find "LISTENING"') do (
    echo Killing process %%a using port 3443
    taskkill /f /pid %%a >nul 2>&1
)

timeout /t 2 /nobreak >nul

echo ✅ Starting KisanMitra server...
echo.
echo Server will be available at: http://localhost:3000
echo Admin panel at: http://localhost:3000/admin
echo.
echo Press Ctrl+C to stop the server
echo.

node server.js

echo.
echo Server stopped. Press any key to exit.
pause >nul
