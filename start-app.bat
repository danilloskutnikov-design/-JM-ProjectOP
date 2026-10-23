@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Не найден Node.js. Установите версию 22.18 или новее: https://nodejs.org & pause & exit /b 1)
where ffmpeg >nul 2>nul || echo Внимание: ffmpeg не найден - видео сделать не получится. Установите ffmpeg или используйте установщик приложения.
echo Запускаю JM ProjectOP... окно браузера откроется само. Закройте это окно, чтобы остановить.
node --disable-warning=ExperimentalWarning app\dev.ts
pause
