@echo off
echo Cleaning up duplicate profiles...
call npx prisma db execute --stdin <<EOF
DELETE FROM Profile 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM Profile 
    GROUP BY name, email
);
EOF
echo.
echo Cleanup complete! Only unique profiles remain.
pause
