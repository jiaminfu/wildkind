@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   TIDEGLASS  -  storefront + admin console
echo   ---------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found. Install Node.js 18+ first: https://nodejs.org
  pause
  exit /b 1
)

if not exist "app\server\data\db.json" (
  echo   [1/2] Generating demo data...
  node app\server\seed.js
) else (
  echo   [1/2] Data file exists, skipping seed.
)

echo   [2/2] Starting server on http://localhost:4600
echo.
echo   Storefront   http://localhost:4600/#/
echo   Admin        http://localhost:4600/#/admin
echo                owner@tideglassjewelry.com / tideglass2026
echo                ops@tideglassjewelry.com   / tideglass-ops  (restricted)
echo.
echo   Documents    handover\README.md
echo   Old design prototype (read-only reference, port 4400):
echo                node server.js
echo.
echo   Press Ctrl+C to stop.
echo.

start "" http://localhost:4600/#/
node app\server\index.js
pause
