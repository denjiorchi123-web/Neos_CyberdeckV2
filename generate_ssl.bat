@echo off
echo Generating CyberDeck Security Certificates...
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=192.168.1.12"
echo.
echo Certificates generated! (key.pem and cert.pem)
pause
