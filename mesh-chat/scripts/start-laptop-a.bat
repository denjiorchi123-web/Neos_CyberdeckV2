@echo off
cd /d "%~dp0.."
echo === CyberDeck Mesh - Laptop-A ===
copy /Y .env.laptop-a .env
call npm install
echo.
echo UI: https://192.168.1.1:3000
node server.js
