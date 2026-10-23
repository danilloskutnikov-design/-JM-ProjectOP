import type { Plan, PlanIssue, StageDef } from '../schema/index.ts';

const KEYWORDS: Array<{ type: string; re: RegExp }> = [
  { type: 'clean', re: /очист|очищ|чист|отмы|помы|мыть|мойк|clean|wash/ },
  { type: 'draw', re: /рисо|рису|нарис|draw|paint/ },
  { type: 'stickers', re: /накле|стикер|sticker/ },
  { type: 'reveal', re: /показ|результат|финал|готов|reveal|result|final/ },
];
export const DEFAULT_TARGET_SEC: Record<string, number> = { clean: 3, draw: 3, stickers: 3, reveal: 2 };

const SEPARATORS = '(?:сначала|затем|потом|далее|после этого|после чего|и|then|and|first|finally|в конце)';

/**
 * Text instruction → plan. Nothing is substituted silently: every phrase that is not understood,
 * ambiguous, unsupported or in an impossible order becomes an explicit issue.
 */
export function parsePlan(text: string, supported: string[]): Plan {
  const issues: PlanIssue[] = [];
  // decimal comma/point inside a number is not a separator ("2,5 сек", "2.5 сек")
  let t = text.toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[,;\n]+|\.(?!\d)/g, '|');
  t = t.replace(new RegExp('(^|\\s)' + SEPARATORS + '(?=\\s|$|\\|)', 'g'), '$1|');
  t = t.replace(new RegExp('(^|\\s)' + SEPARATORS + '(?=\\s|$|\\|)', 'g'), '$1|');
  const chunks = t.split('|').map((c) => c.trim()).filter(Boolean);

  const stages: StageDef[] = [];
  for (const chunk of chunks) {
    const dm = chunk.match(/(\d+(?:[.,]\d+)?)\s*(?:секунд[а-я]*|сек|с|sec|s)(?![а-яa-z])/);
    const sec = dm ? parseFloat(dm[1].replace(',', '.')) : null;
    const types = KEYWORDS.filter((k) => k.re.test(chunk)).map((k) => k.type);
    if (types.length === 0) {
      if (sec !== null && stages.length > 0 && chunk.replace(dm![0], '').trim() === '') { stages[stages.length - 1].targetSec = sec; continue; }
      issues.push({ severity: 'error', chunk, message: `Фраза не распознана: «${chunk}». Укажите один из этапов: очистка, рисование, наклейки, показ результата.` });
      continue;
    }
    if (types.length > 1) {
      issues.push({ severity: 'error', chunk, message: `В одной фразе несколько этапов (${types.join(', ')}): «${chunk}». Разделите на отдельные шаги.` });
      continue;
    }
    const type = types[0];
    if (!supported.includes(type)) {
      issues.push({ severity: 'error', chunk, message: `Этап «${type}» не поддерживается в этой версии.` });
      continue;
    }
    if (stages.some((s) => s.type === type)) {
      issues.push({ severity: 'error', chunk, message: `Этап «${type}» повторяется: повтор этапов в V1 не поддерживается.` });
      continue;
    }
    const target = sec ?? DEFAULT_TARGET_SEC[type] ?? 3;
    if (target < 1 || target > 10) issues.push({ severity: 'warning', chunk, message: `Длительность ${target} с выглядит нетипично (ожидается 1–10 с).` });
    stages.push({ id: type, type, targetSec: target });
  }
  if (stages.length === 0) issues.push({ severity: 'error', chunk: text, message: 'В инструкции не найдено ни одного этапа.' });
  const ri = stages.findIndex((s) => s.type === 'reveal');
  if (ri >= 0 && ri !== stages.length - 1) {
    issues.push({ severity: 'error', chunk: 'reveal', message: 'Показ результата должен быть последним этапом: после него в кадре нечего делать.' });
  }
  return { stages, issues, ok: !issues.some((i) => i.severity === 'error') };
}
