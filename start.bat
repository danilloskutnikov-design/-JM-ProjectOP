@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Не найден Node.js. Установите версию 22.18 или новее: https://nodejs.org & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Не найден ffmpeg. Установите его и добавьте в PATH: https://ffmpeg.org/download.html & pause & exit /b 1)

echo Собираю демо-ролики (около минуты)...
node --disable-warning=ExperimentalWarning packages\cli\main.ts demo --scale 0.5 --outdir out\demo
if errorlevel 1 (echo Ошибка. Проверьте, что Node.js версии 22.18 или новее. & pause & exit /b 1)
echo.
echo Готово. Ролики лежат в папке out\demo
explorer out\demo
pause
