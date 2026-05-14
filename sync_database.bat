@echo off
echo Syncing database schema and generating client...
call npx prisma generate
call npx prisma db push
echo.
echo Database is now in sync with the CyberDeck code!
echo You can now run 'npm run dev'
pause
