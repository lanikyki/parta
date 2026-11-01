@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Не найден Node.js. Скачайте версию LTS с сайта https://nodejs.org , установите и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)
node scripts\dev-all.mjs --share
echo.
pause
