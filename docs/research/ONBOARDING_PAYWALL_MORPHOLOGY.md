# JM ProjectOP — исследование морфологии онбордингов и пейволов

**Дата:** 2026-10-23. **Тип:** аналитическое исследование и рекомендации по архитектуре. **Статус:** исследование, не утверждённая спецификация.  
**Фокус:** UX, экономика, психология, форма, динамика, паттерны, ограничения и видеоконтент для Phone Case.

> Ключевое различие: **норма** (требования платформ и стандарты), **наблюдения** (отраслевые данные в определённой выборке) и **гипотезы** (требуют эксперимента). Смешивать нельзя.

## 1. Онтология

**Onboarding** — процесс освоения продукта, повышения понимания и доведения до первого успешного действия. Не эквивалентен слайдеру из вводных карточек.

**Paywall** — экран предложения, выбора и инициирования покупки; связан с подписочным состоянием, тарифом, возможностью отказа и системным биллингом. Не эквивалентен красивой рекламе.

**Связь**: onboarding → первое значимое действие → результат → опционально paywall, но существуют другие маршруты: paywall до использования, по достижении лимита, у конкретной функции, при возврате. Нельзя считать путь строго линейным для любого пользователя.

### Морфологические уровни

1. **Контекстный**: источники аудитории, user state, триггер, сегмент, страна, eligibility.
2. **Сценарный**: последовательность, ветвление, prerequisite, exit.
3. **Семантический**: ценность, функция, доказательство, обещание, выгода, цена.
4. **Композиционный**: hero, фон, цена, controls, центр тяжести, пустоты, маски.
5. **Перцептивный**: причинно-следственная ясность, движение, когнитивная нагрузка.
6. **Интерактивный**: действие, CTA, отказ, выбор тарифа, восстановление.
7. **Аналитический**: показ, переход, активация, продажа, отказ, удержание.

## 2. Таксономия онбордингов

| Вид | Содержание | Риск |
| --- | --- | --- |
| Value-first | зачем использовать продукт, наблюдаемый результат | обещания вместо доказательства |
| Feature carousel | серия преимуществ и иллюстраций | длительность и запоминание |
| Contextual tips | подсказка рядом с реальным действием | подсказок слишком много |
| Interactive | совершить полезное действие самим | принудительность |
| Personalization | реальные настройки под цель | лишние вопросы/сбор данных |
| Setup & permissions | разрешение по месту использования | запрос до объяснения пользы |
| Checklist | содержательные небольшие шаги | искусственный прогресс |
| No-onboarding | доступ к основному действию сразу | сложная механика без помощи |

NN/g обнаруживает, что принудительные вводные материалы могут увеличивать стоимость действий и не обязательно улучшают реальные навыки. Apple советует быстрый, интерактивный и опциональный онбординг. Важнее **first value**, чем полное досматривание презентации. [NN/g](https://www.nngroup.com/articles/mobile-app-onboarding/) · [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/onboarding) · [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

## 3. Таксономия пейволов

**По модели доступа:** hard paywall, freemium, feature-gated, metered/quota, trial-led, post-value, upgrade, win-back.

**По компоновке:** hero-first, benefits-first, pricing-first, free-vs-premium comparison, trial timeline, compact native, interactive preview, long scrolling editorial.

**По времени появления:** завершение onboarding, после результата, при касании закрытой функции, по исчерпании лимита, повторное предложение с ограничением частоты. Нужно проверять entitlement/eligibility, не показывать недоступные trial и не просить повторную оплату у подписчика.

### Обязательные смысловые атомы

| Атом | Роль |
| --- | --- |
| Value proposition | за что платит человек |
| Evidence / hero video | реальная демонстрация продукта |
| Benefits | доступные функции, без обобщённых ложных обещаний |
| Plan selector | понятное сравнение тарифов |
| Total price & period | сколько реально списывается и когда |
| Trial & renewal | сроки, автопродление, полная будущая цена |
| CTA | соответствует выполняемому действию |
| Close / dismiss | возможность отказа там, где должна быть |
| Restore & manage | восстановление и управление подпиской |
| Terms / Privacy | доступные ссылки, но не скрытие ключевых условий |

**[Норма]** Apple требует ясного имени/срока подписки, полной цены продления, восстановления; сумма полного списания должна доминировать над вторичным представлением «за неделю». Google запрещает вводящие в заблуждение подписочные предложения; явно указываются период, цена, автоматическое продление и обязательность подписки. [Apple Subscriptions](https://developer.apple.com/app-store/subscriptions/) · [Google Play policy](https://support.google.com/googleplay/android-developer/answer/9900533?hl=en)

## 4. Психология: конструкт, а не магическая формула

| Механизм | Осторожное применение | Граница |
| --- | --- | --- |
| Cognitive load | одна видимая задача на шаг | не прятать платёжные условия |
| Progressive disclosure | опциональные детали по потребности | не скрывать существенную цену |
| Mental models | знакомый инструмент + очевидный результат | не симулировать недоступную механику |
| Competence / mastery | человек видит, что он может добиться результата | не создавать искусственную зависимость |
| Autonomy | выбор, skip, close | не подавлять отказ |
| Fogg motivation–ability–prompt | предложение в момент ясной ценности | не спамить просьбами |
| Feedback & closure | видно, что действие завершено | не рисовать фальшивый прогресс |
| Uncertainty reduction | прозрачный trial и способ отмены | не маскировать recurring billing |
| Social proof | только проверяемые факты | не сочинять отзывы |
| Scarcity | только реальные сроки и ограничения | фальшивый countdown = dark pattern |

[Stanford — Fogg Behavior Model](https://behaviordesign.stanford.edu/resources/fogg-behavior-model) · [APA — Self-Determination Theory](https://www.apa.org/research-practice/conduct-research/self-determination-theory) · [FTC — Dark Patterns](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers)

**[Гипотеза]** Для Phone Case демонстрация «грязно → очищено → нарисовано → оформлено» создаёт ясную причинность. Нельзя утверждать, что эта последовательность увеличивает подписки, пока нет измерений.

## 5. Визуальная морфология

Слои:
- **Background**: нейтральный, градиентный, фирменный, контекстный, статичный/живой.
- **Hero object**: чехол, вариант материала, форма, расположение, размер.
- **Agent/tool**: кисть, чистящий инструмент, указатель действия.
- **Change/outcome**: прогресс очистки, раскрытие рисунка, наклейка, готовый результат.
- **Secondary FX**: движение камеры, искры, акцент и фактура.
- **Host UI**: тексты, тарифы, CTA, close, legal — НЕ часть видеослоя в V1.
- **Composition guides**: сейвзоны и exclusion regions — техническая разметка, НЕ в MP4.

Дизайнер должен контролировать не только центр объекта, но и **динамические bounds** объекта/инструмента во всех кадрах. Макет проверять в контексте **полного экрана приложения**, а не только изолированного видеокадра.

Основные архетипы изображения: square hero, media card, portrait scene, full-bleed background, split-layout. В маленьком слоте рисунок и чехол должны быть достаточно крупными, чтобы различать изменения без чтения текста.

## 6. Временная морфология

| Паттерн | Грамматика |
| --- | --- |
| Transformation | ДО → видимое изменение → ПОСЛЕ |
| Tutorial | подсказка/инструмент → действие → обратная связь |
| Process | clean → draw → stickers → reveal |
| Result-first | готовый результат → процесс происхождения |
| Macro–micro | общий вид → деталь действия → общий результат |
| Repeated variation | одно действие на разных чехлах/стилях |
| Cut loop | конец → монтажный стык → начало |
| Smooth loop | согласованное конечное и начальное состояния |

Управляемые величины: кадры каждого этапа, позиция инструмента, длительность удержания результата, zoom, скорость, главный визуальный акцент, монтируемые интервалы, тип петли, стиль движения. Любой «оптимальный тайминг» — предмет UX-эксперимента, а не универсальная норма.

**[Доступность]** Для автодвижущегося контента учитывать возможность паузы/остановки по WCAG SC 2.2.2 при соответствующих условиях; для анимаций — reduced motion; ограничивать фоточувствительные вспышки. Пауза/close реализуются **host-приложением**, а не внутри закодированного MP4. [W3C Pause/Stop/Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide) · [Animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) · [Flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

## 7. Эмпирические ориентиры RevenueCat 2026

Выборка отчёта включает более **115 000** приложений, интегрировавших RevenueCat (расчёты преимущественно за **2025** год). Это **наблюдательные** цифры — не причинные эффекты дизайна:

- **D35 download-to-paid**: median **10,7% hard paywall vs 2,1% freemium**, нельзя переносить результат на любой продукт.
- В большинстве категорий **78–90%** trial starts — в день установки.
- **Два тарифных плана** встречаются у **41–60%** исследованных paywalls в разных категориях.
- Таймеры обратного отсчета — **1,4%**; progress bars — **0,2%** paywalls.
- Среди отмен 3-дневного trial **55%** приходится на день 0 (от всех **отмен**, не всех запустивших trial).
- Gaming D30 download-to-trial median **4,4%** — это не значение для конкретной Phone Case.

[Источник и описание выборки: RevenueCat, State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/).

## 8. Как это меняет архитектуру JM ProjectOP

**Разделить Host UI и экспортируемый медиа-слой**:

```text
HOST APP
  products + localized prices + trial eligibility + CTA + close + restore
  owns MediaSlot / Size / ExclusionRects / Play & Pause / Analytics
        │
        │ passes validated media constraints
        ▼
JM PROJECTOP
  Phone Case scenario + actions + events + source states + edit decisions
  → compositional validation → frames → H.264 MP4
  + manifest: frame count, loops, bounds, included stages, versions
```

**НЕ запекать** текущие суммы платежей, тарифные цены, «бесплатность» trial, фальшивую кнопку закрытия и текстовые legal terms в video layer.

### Конкретные пресеты

| Слот | Кадр | Safe zone |
| --- | --- | --- |
| Onboard | 1124×1124 | x 150–974, y 150–974 (824×824) |
| Paywall | 1124×1000 | x 200–924, y 185–815 (724×630) |

Отступы пропорционально масштабируются. Ввести дополнительные настраиваемые **ExclusionRegions** под реальные элементы host UI, включая крестик закрытия (не делать его менее заметным). Контроль должен проходить покадрово по bounds всех важных объектов.

### Предлагаемые новые поля render brief

```json
{
  "compositionIntent": "paywall-value-proof",
  "storyGrammar": "before-action-after",
  "slotPreset": "paywall-1124x1000",
  "durationFrames": 180,
  "fps": 30,
  "loopMode": "smooth",
  "audioIndependent": true,
  "motionIntensity": "low",
  "importantEntities": ["case", "tool", "result"],
  "exclusionRegions": [],
  "stageCoverage": ["clean", "draw", "stickers", "reveal"]
}
```

Это **пример будущего контракта**, не готовая схема или обязательная длительность.

## 9. Морфологическая матрица вариативности

| Ось | Значения | Ответственный модуль |
| --- | --- | --- |
| Intent | onboard/how-to; paywall/value proof | brief/project |
| Narrative | transformation, tutorial, sequential, reveal | scenario |
| Mechanic | clean/draw/sticker/reveal | Phone Case |
| Object | case, drawing, sticker, palette | asset/gameplay |
| Tempo | stage durations, retime | timeline |
| Emphasis | result-first, action-first | montage |
| Camera | static, zoom, pan, orbit where valid | renderer |
| Background | plain, contextual, branded | scene |
| Motion | calm, playful, reduced | animation |
| Loop | none, cut, smooth | export |
| Preset | onboard, paywall, custom | layout |
| Exclusions | UI overlay, close zone, price area | layout validation |
| Variant ID | control, A, B, holdout | project manifest |

Генерировать **валидные семантические комбинации**, а не декартово произведение всех параметров. При смене рисунка инвалидацировать рисование и зависящий финал; при смене фона — перерендерить визуальные сегменты; при смене пресета — пересчитать композицию и safe zone.

## 10. Метрики и эксперименты

**Onboarding:** shown → skip/complete → first action → first valid result → D1/D7 retention; отдельно time-to-value и comprehension score.

**Paywall:** eligible → exposed → plan selected → purchase started → store confirmed → retained subscription; конверсию не приравнивать к кликам CTA. Считать также refund, cancellation, trust and comprehension guardrails.

**Media quality:** meaningful change latency, result visibility frames, object bounds, safe zone violations, tool occlusion frames, loop seam difference, black frames, preview/render consistency.

**A/B-тесты:** фиксировать когорту, randomization unit, сроки, primary metric, guardrails. Не менять вместе цену, аудиторию, место появления и видео и не приписывать рост/падение одной визуальной детали без контролируемого теста. Пять коммерческих рычагов Superwall: price/packaging, design, messaging, placement/frequency, personalization — методология вендора, не доказательство улучшений. [Superwall](https://superwall.com/blog/how-we-test-paywalls-at-superwall-and-how-you-can-too/)

### Исходный план video experiments для Phone Case

- **V01:** result-first vs process-first; цель — проверка скорости понимания ценности.
- **V02:** спокойная камера vs фиксированная; смотреть отвлекаемость и видимость объекта.
- **V03:** короткое vs длинное раскрытие рисунка; comprehension и time-to-value.
- **V04:** минимальные vs декоративные частицы; perceptual clarity.
- **V05:** cut loop vs smooth; субъективная заметность границы и технические артефакты.
- **V06:** нейтральный vs адаптированный фон вокруг close exclusion; discoverability close и читаемость.
- **V07:** один чехол vs несколько вариантов; узнаваемость результата.
- **V08:** полная цепь vs один наиболее выразительный этап; понимание ограниченного слота.

## 11. Этика, платформа и право

- Ясно отражать полную сумму списания, срок trial, автопродление и отказ/управление [Apple](https://developer.apple.com/app-store/subscriptions/) и [Google](https://support.google.com/googleplay/android-developer/answer/9900533?hl=en).
- Не генерировать fake urgency, ложные прогресс-бары, имитацию платного результата, скрытую цену или отвлекающий от закрытия контент. [FTC](https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers).
- При Kids Category покупки/внешние переходы — за родительским барьером. [Apple guideline 1.3](https://developer.apple.com/app-store/review/guidelines/). Не считать Phone Case детским приложением автоматически.
- FTC Click-to-Cancel Rule 2024 года отменено судебным решением в июле 2025 — не выдавать его за действующее общее правило. [Reuters](https://www.reuters.com/legal/legalindustry/us-click-cancel-rule-blocked-appeals-court-2025-07-08/).
- Поддержка reduced motion и доступности должна планироваться отдельно в host app; video exporter может выпускать статические/reduced-motion альтернативы.

## 12. Приоритеты для реализации

**MUST V1:** семантические метки события и stage; story intent; asset swap; frame-accurate safe zones + exclusions; 2 пресета; deterministic capture; editable timeline; rerender; cut/smooth loop; беззвучная понятность; MP4 H.264 30 FPS.

**SHOULD:** визуальный предпросмотр через mock host UI, вариативные шаблоны story grammar, подробный render manifest, reduced-motion alternative, пакетный тестовый экспорт.

**LATER:** сбор анонимной аналитики реальных экранов/данных экспериментов, дополнительные игры, ML/LLM для монтажного отбора только при недостаточности event rules.

### Следующий исследовательский шаг

Для перехода от теоретической морфологии к продуктовому дизайну получить **фактические скриншоты и layout requirements** экранов Phone Case (положение текста, CTA, крестика, размеры media slot на устройствах), составить аннотированную выборку и провести тестирование понимания. Статические Dribbble-макеты не заменяют реальные paywall UX.

## Библиография (дополнительно)

- [NN/g: onboarding tutorials and contextual help](https://www.nngroup.com/articles/onboarding-tutorials/)
- [Apple HIG: In-App Purchase](https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase)
- [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Google Play: Manage subscriptions](https://support.google.com/googleplay/android-developer/answer/140504)
- [FTC 2024 ICPEN/GPEN review (642 services)](https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-icpen-gpen-announce-results-review-use-dark-patterns-affecting-subscription-services-privacy)

**Уровень применимости:** это таксономия и проектные гипотезы, а не гарантированно успешные практики. Установленные обязательные правила зависят от магазина, региона и категории приложения.
