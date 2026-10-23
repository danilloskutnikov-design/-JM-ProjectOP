#!/bin/sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Не найден Node.js 22.18+: https://nodejs.org"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || echo "Внимание: ffmpeg не найден — видео сделать не получится."
exec node --disable-warning=ExperimentalWarning app/dev.ts
