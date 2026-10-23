#!/bin/sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Не найден Node.js. Установите версию 22.18 или новее: https://nodejs.org"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "Не найден ffmpeg. Установите его (на Mac: brew install ffmpeg)."; exit 1; }
echo "Собираю демо-ролики (около минуты)..."
node --disable-warning=ExperimentalWarning packages/cli/main.ts demo --scale 0.5 --outdir out/demo || { echo "Ошибка. Проверьте, что Node.js версии 22.18 или новее."; exit 1; }
echo
echo "Готово. Ролики лежат в папке out/demo"
command -v open >/dev/null 2>&1 && open out/demo
command -v xdg-open >/dev/null 2>&1 && xdg-open out/demo >/dev/null 2>&1
exit 0
