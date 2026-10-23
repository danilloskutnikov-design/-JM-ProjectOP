import type { Registry } from '../core/index.ts';
import type { Project, Timeline } from '../schema/index.ts';
import { validateProject } from '../schema/index.ts';
import { buildTimeline } from '../editor/index.ts';
import { bestLineage, producer, runTake, validPrefix, verifyTake } from '../session/index.ts';
import { buildGameConfig, computeStageKeys, refreshAssetHashes, seedForTake } from './project.ts';
import type { AssetMap } from './project.ts';

export interface BuildContext { registry: Registry; assets: AssetMap }

export interface BuildReport {
  attempts: number;
  newTakes: string[];
  failures: Array<{ take: string; code: string; stage?: string; message: string }>;
  /** Stages that were re-simulated because their inputs changed (or had no material). */
  regenerated: string[];
  /** Stages whose existing material was reused as is. */
  reused: string[];
  timeline: Timeline;
}

export function stageStatus(p: Project, ctx: BuildContext): { keys: string[]; valid: number; stale: string[] } {
  const cfg = buildGameConfig(p, ctx.assets);
  const keys = computeStageKeys(p, cfg, ctx.registry);
  const { valid } = bestLineage(p.takes, keys);
  return { keys, valid, stale: p.scenario.stages.slice(valid).map((s) => s.id) };
}

/**
 * Make the project consistent with its current inputs:
 *  - keep every stage whose inputs are unchanged,
 *  - re-simulate only from the first stale stage (starting from the preserved state),
 *  - retry with a new seed if a take stalls ("доснять дубль"),
 *  - rebuild the edit. The edit plan (order, durations) is never touched by asset replacement.
 */
export function rebuild(p: Project, ctx: BuildContext, opts: { maxAttempts?: number; stallSeconds?: number } = {}): BuildReport {
  const problems = validateProject(p);
  if (problems.length) throw new Error('invalid project: ' + problems.join('; '));
  const cfg = buildGameConfig(p, ctx.assets);
  const keys = computeStageKeys(p, cfg, ctx.registry);
  const stages = p.scenario.stages;
  const failures: BuildReport['failures'] = [];
  const newTakes: string[] = [];
  const start = bestLineage(p.takes, keys).valid;
  let attempts = 0;
  for (;;) {
    const { take: best, valid } = bestLineage(p.takes, keys);
    if (valid >= stages.length || attempts >= (opts.maxAttempts ?? 4)) break;
    attempts++;
    const n = p.takes.length + 1;
    const parentTake = best ? producer(best, valid, p.takes) : null;
    const take = runTake({
      id: `take-${n}`, cfg, registry: ctx.registry, seed: seedForTake(p, n),
      persona: p.scenario.persona, speed: p.scenario.speed, stageKeys: keys,
      parent: parentTake ? { take: parentTake, stage: valid, takes: p.takes } : null,
      stallSeconds: opts.stallSeconds,
    });
    p.takes.push(take);
    newTakes.push(take.id);
    if (take.status === 'failed') failures.push({ take: take.id, code: take.error!.code, stage: take.error!.stage, message: take.error!.message });
  }
  refreshAssetHashes(p, ctx.assets);
  p.modLock = ctx.registry.snapshot();
  p.timeline = buildTimeline(p, keys);
  return {
    attempts, newTakes, failures,
    regenerated: stages.slice(start).map((s) => s.id),
    reused: stages.slice(0, start).map((s) => s.id),
    timeline: p.timeline,
  };
}

export interface VerifyReport { take: string; validStages: number; checked: 'full' | 'prefix' | 'skipped'; ok: boolean; problems: string[] }

/** Replay every take from its recorded actions only and compare events and state fingerprints. */
export function verifyProject(p: Project, ctx: BuildContext): VerifyReport[] {
  const cfg = buildGameConfig(p, ctx.assets);
  const keys = computeStageKeys(p, cfg, ctx.registry);
  const out: VerifyReport[] = [];
  for (const t of p.takes) {
    const n = validPrefix(t, p.takes, keys);
    if (n === 0) { out.push({ take: t.id, validStages: 0, checked: 'skipped', ok: true, problems: ['stale: inputs changed since recording'] }); continue; }
    const full = n >= keys.length && t.stageKeys.every((k, i) => k === keys[i]);
    let until: number | undefined;
    if (!full) {
      const prod = producer(t, n - 1, p.takes)!;
      until = prod.segments.find((s) => s.stage === n - 1)!.endTick;
    }
    const r = verifyTake(cfg, ctx.registry, p.takes, t, until);
    out.push({ take: t.id, validStages: n, checked: full ? 'full' : 'prefix', ok: r.ok, problems: r.problems });
  }
  return out;
}
