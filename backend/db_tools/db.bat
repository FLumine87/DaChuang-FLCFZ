@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set COMPOSE_FILE=db_tools\docker-compose.db.yml
set CONTAINER_NAME=mental-screening-db-tools

if "%1"=="" goto help
if "%1"=="help" goto help
if "%1"=="start" goto start
if "%1"=="stop" goto stop
if "%1"=="init" goto init
if "%1"=="reset" goto reset
if "%1"=="shell" goto shell
if "%1"=="sql" goto sql
if "%1"=="backup" goto backup
if "%1"=="restore" goto restore
if "%1"=="status" goto status
if "%1"=="build" goto build

echo Unknown command: %1
goto help

:help
echo.
echo Database Management Tool
echo.
echo Usage: db.bat [command]
echo.
echo Commands:
echo   start     Start database container
echo   stop      Stop container
echo   init      Initialize database (create tables and sample data)
echo   reset     Reset database (drop and reinitialize)
echo   shell     Enter Python interactive shell
echo   sql       Enter SQLite command line
 echo   backup    Backup database to data folder
echo   restore   Restore database from backup
 echo   status    Show database status
echo   build     Build Docker image
echo.
goto end

:build
echo Building database management image...
docker compose -f %COMPOSE_FILE% build
goto end

:start
echo Starting database container...
docker compose -f %COMPOSE_FILE% up -d
echo Container started. Use 'db.bat shell' to enter interactive mode.
goto end

:stop
echo Stopping container...
docker compose -f %COMPOSE_FILE% down
goto end

:init
echo Initializing database...
docker compose -f %COMPOSE_FILE% up -d --build 2>nul
docker exec -it %CONTAINER_NAME% python init_data.py
echo.
echo Done!
echo Database file: mental_screening.db
goto end

:reset
echo Resetting database...
if exist ..\mental_screening.db del ..\mental_screening.db
docker compose -f %COMPOSE_FILE% up -d --build 2>nul
docker exec -it %CONTAINER_NAME% python init_data.py
echo.
echo Database reset complete!
goto end

:shell
docker compose -f %COMPOSE_FILE% up -d 2>nul
docker exec -it %CONTAINER_NAME% python
goto end

:sql
docker compose -f %COMPOSE_FILE% up -d 2>nul
docker cp db_tools\sqlite_shell.py %CONTAINER_NAME%:/app/sqlite_shell.py
docker exec -it %CONTAINER_NAME% python sqlite_shell.py
goto end

:backup
set TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
if not exist ..\data mkdir ..\data
copy ..\mental_screening.db ..\data\backup_%TIMESTAMP%.db
echo Backup saved to: data\backup_%TIMESTAMP%.db
goto end

:restore
echo Available backup files:
echo.
dir /b ..\data\backup_*.db 2>nul
if errorlevel 1 (
    echo No backup files found.
    goto end
)
echo.
set /p BACKUP_FILE="Enter backup filename: "
if exist ..\data\%BACKUP_FILE% (
    copy ..\data\%BACKUP_FILE% ..\mental_screening.db
    echo Database restored from %BACKUP_FILE%
) else (
    echo File not found: %BACKUP_FILE%
)
goto end

:status
docker compose -f %COMPOSE_FILE% up -d 2>nul
echo.
echo === Database Status ===
echo.
docker exec %CONTAINER_NAME% python -c "import sqlite3; conn = sqlite3.connect('mental_screening.db'); cursor = conn.cursor(); print('Users:', cursor.execute('SELECT COUNT(*) FROM users').fetchone()[0]); print('Questionnaires:', cursor.execute('SELECT COUNT(*) FROM questionnaires').fetchone()[0]); print('Screenings:', cursor.execute('SELECT COUNT(*) FROM screenings').fetchone()[0]); print('Alerts:', cursor.execute('SELECT COUNT(*) FROM alerts').fetchone()[0]); print('Cases:', cursor.execute('SELECT COUNT(*) FROM cases').fetchone()[0]); conn.close()"
echo.
goto end

:end
endlocal
