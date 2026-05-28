@echo off
cd /d "%~dp0.."
echo === CyberDeck Mesh - Laptop-B ===
copy /Y .env.laptop-b .env
echo Peer Laptop-A: 192.168.1.1
ping -n 2 192.168.1.1
call npm install
echo.
echo UI: http://192.168.1.2:3000
node server.js
