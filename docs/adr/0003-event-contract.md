# ADR 0003 — Контракт событий

**Статус:** принято; имена взяты из `PRODUCT_SPEC.md` §3.

| Событие | Когда | `data` |
|---|---|---|
| `stage.started` | начало этапа | `index`, `resumed?` |
| `action.started` | указатель нажат / началось удержание | `action` (`scrub`/`stroke`/`drag`/`tap`/`hold`), доп. поля |
| `action.progress` | каждые 6 тиков действия | `action`, `progress` |
| `action.completed` | действие закончено | `action`, `durationTicks`, `progressDelta`, `placed?`/`fixed?` |
| `visual.change` | заметное изменение (≥ 5 % прогресса или значимое событие) | `intensity`, `bbox`, `progress` |
| `stage.completed` | этап завершён | `index`, `stateHash` |
| `result.ready` | готов финальный результат (ровно один раз) | `stateHash` |
| `capture.failed` | дубль прерван | `code`, `message` |

Все события несут `tick`, `stageId`, `stageType`. Монтаж опирается только на них, не на анализ видео.
Правила отбора живут в монтаже (`editor/timeline.ts`): действия с `placed`/`fixed` защищены от отбрасывания.
