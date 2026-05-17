@echo off
:: CyberDeck — launch dev server with Administrator rights
:: Double-click this file, approve the UAC prompt, and the server starts elevated.

net session >nul 2>&1
if %errorLevel% == 0 goto :run

:: Not admin — re-launch self via PowerShell RunAs
powershell -NoProfile -Command ^
  "Start-Process cmd -Verb RunAs -ArgumentList '/k cd /d \"%CD%\" && npm run dev'"
exit /b

:run
echo [CyberDeck] Running as Administrator
npm run dev
pause
