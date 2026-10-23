import type { Take } from '../schema/index.ts';

/** The take whose own actions produced stage `i` of `take`'s timeline. */
export function producer(take: Take, i: number, takes: Take[]): Take | null {
  let t: Take | undefined = take;
  while (t && i < t.startStage) t = t.parent ? takes.find((x) => x.id === t!.parent!.takeId) : undefined;
  return t ?? null;
}

/**
 * Number of leading stages of `take` that are (a) completed and (b) valid under the
 * current stage keys. Valid means: all keys up to and including the stage are unchanged,
 * so replaying produces the same state as when it was recorded.
 */
export function validPrefix(take: Take, takes: Take[], keys: string[]): number {
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    if (take.stageKeys[i] !== keys[i]) break;
    const p = producer(take, i, takes);
    const seg = p?.segments.find((s) => s.stage === i);
    if (!seg || !seg.completed) break;
    n++;
  }
  return n;
}

/** The take (lineage) with the longest valid prefix; ties go to the newest take. */
export function bestLineage(takes: Take[], keys: string[]): { take: Take | null; valid: number } {
  let best: Take | null = null;
  let bestN = 0;
  for (const t of takes) {
    const n = validPrefix(t, takes, keys);
    if (n >= bestN && n > 0) { best = t; bestN = n; }
  }
  return { take: best, valid: bestN };
}
