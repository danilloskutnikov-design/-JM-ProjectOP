import type { Project } from './types.ts';

/** Minimal structural validation. Returns a list of problems (empty = ok). */
export function validateProject(p: unknown): string[] {
  const errs: string[] = [];
  const o = p as Partial<Project> | null;
  if (!o || typeof o !== 'object') return ['project is not an object'];
  if (o.schemaVersion !== 1) errs.push(`unsupported schemaVersion: ${String(o.schemaVersion)}`);
  if (!o.preset || typeof o.preset.width !== 'number' || typeof o.preset.height !== 'number') errs.push('preset is missing or malformed');
  if (!o.scenario || !Array.isArray(o.scenario.stages) || o.scenario.stages.length === 0) errs.push('scenario.stages is empty');
  else {
    const ids = new Set<string>();
    for (const s of o.scenario.stages) {
      if (ids.has(s.id)) errs.push(`duplicate stage id: ${s.id}`);
      ids.add(s.id);
      if (!(s.targetSec > 0)) errs.push(`stage ${s.id}: targetSec must be > 0`);
    }
  }
  if (!o.scene) errs.push('scene is missing');
  else {
    if (!Array.isArray(o.scene.stickers)) errs.push('scene.stickers must be an array');
    else if (o.scene.stickers.length > 4) errs.push('scene.stickers: at most 4 stickers are supported in V1');
    if (typeof o.scene.drawing !== 'string') errs.push('scene.drawing must be an asset id');
    if (typeof o.scene.background !== 'string') errs.push('scene.background must be an asset id');
  }
  if (!Array.isArray(o.takes)) errs.push('takes must be an array');
  else {
    const ids = new Set<string>();
    for (const t of o.takes) {
      if (ids.has(t.id)) errs.push(`duplicate take id: ${t.id}`);
      ids.add(t.id);
      if (t.parent && !o.takes.some((x) => x.id === t.parent!.takeId)) errs.push(`take ${t.id}: parent ${t.parent.takeId} not found`);
      if (t.actions.length !== t.ticks) errs.push(`take ${t.id}: actions.length (${t.actions.length}) != ticks (${t.ticks})`);
    }
  }
  return errs;
}
