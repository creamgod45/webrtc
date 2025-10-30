@echo off
echo Fixing PostgreSQL permissions...
echo.
echo Please enter your PostgreSQL superuser password when prompted
echo.

REM Replace 'postgres' with your PostgreSQL username if different
set PG_USER=webrtc_voice
set DB_NAME=webrtc_voice

echo Connecting to PostgreSQL and granting permissions...
psql -U %PG_USER% -d %DB_NAME% -c "GRANT ALL ON SCHEMA public TO %PG_USER%;"
psql -U %PG_USER% -d %DB_NAME% -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %PG_USER%;"
psql -U %PG_USER% -d %DB_NAME% -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %PG_USER%;"
psql -U %PG_USER% -d %DB_NAME% -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %PG_USER%;"
psql -U %PG_USER% -d %DB_NAME% -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %PG_USER%;"
psql -U %PG_USER% -d %DB_NAME% -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

echo.
echo Permissions have been updated!
echo You can now run: npm run migrate
pause
