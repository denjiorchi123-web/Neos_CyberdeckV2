@echo off
echo Launching CyberDeck in Secure Mode...
start chrome "http://192.168.1.12:3000" --unsafely-treat-insecure-origin-as-secure="http://192.168.1.12:3000" --user-data-dir="%TEMP%\cyberdeck_profile"
echo.
echo Chrome has been launched with media permissions enabled for your local network.
pause
