# JM ProjectOP — прототип 0.1: запуск

Требуется Node ≥ 22.18 и `ffmpeg` в PATH.

**Самый простой запуск:** двойной клик по `start.bat` (Windows) или `start.command` (Mac) / `./start.sh` (Linux). Установка через `npm install` для этого не нужна. Через минуту папка `out/demo` откроется с готовыми роликами.

```bash
npm install                 # только dev-зависимости (типы)
npm test                    # 35 тестов, ≈ 1 мин
npm run typecheck
npm run demo -- --scale 0.5 # три сценария приёмки → out/demo/*.mp4
```

## Как сделать ролик

```bash
npm run cli -- plan "Сначала очистка чехла, затем рисование, затем наклейки и показ результата"
npm run cli -- new --preset onboard --out out/p.json          # автоигра + монтаж
npm run cli -- contact out/p.json --out out/contact.png       # посмотреть монтаж
npm run cli -- render out/p.json --out out/p.mp4 --scale 1    # MP4 H.264 30 FPS
```

`--preset paywall --quiet X,Y,W,H` задаёт зону под крестик (в px полного кадра); при `render` она проверяется.
Предпросмотр с направляющими: `preview p.json --frame 100 --out out/f.png`.

## Как заменить ассет и пересобрать

1. Положить JSON ассета в каталог ассетов (`examples/assets`, формат — см. файлы там; для реальных ассетов задать `PROJECTOP_ASSETS`).
2. `npm run cli -- swap out/p.json --drawing drawing-flower` — покажет, какие этапы нужно перегенерировать.
3. `npm run cli -- rebuild out/p.json` — пересимулирует только их, монтажный план сохранится.
4. `render` — новый MP4.

Фон и цвет чехла (`--background`, `--case-color`) перегенерации не требуют.

## Как изменить сценарий

Передать другую инструкцию в `new --text "..."`. Нераспознанное, неоднозначное и невозможное (повтор этапа, показ не последним) помечается ошибкой, молча ничего не подменяется. Длительность: «очистка 4 сек».

## Пакетная сборка

`batch p.json variants.json --outdir out/batch`, где файл — массив `{name, preset?, quietZone?, background?, drawing?, stickers?, caseColor?, persona?, scale?}`.

## Ограничения прототипа

Только cut-loop; нет камеры, переходов, UI; ассеты — заглушки; моды (T1) и MCP не реализованы. В `.gitignore` добавьте `out/`.
