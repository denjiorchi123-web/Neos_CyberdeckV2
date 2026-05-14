@echo off
echo Launching CyberDeck Secure Node...
set SITE_URL=http://192.168.1.12:3000
start chrome "%SITE_URL%" --unsafely-treat-insecure-origin-as-secure="%SITE_URL%" --user-data-dir="%TEMP%\cyberdeck_secure_profile" --no-first-run
echo.
echo Chrome has been launched in "Local Secure Mode".
echo Your camera and voice are now unlocked for this session.
pause
