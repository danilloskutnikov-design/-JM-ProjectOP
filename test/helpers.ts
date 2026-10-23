import { fileURLToPath } from 'node:url';
import { hashBytes } from '../packages/core/index.ts';
import { bootstrap, loadAssets, newProject, rebuild, renderTimeline } from '../packages/project/index.ts';
import type { BuildContext, NewProjectOptions } from '../packages/project/index.ts';
import type { Project, StageDef } from '../packages/schema/index.ts';

export const STAGES: StageDef[] = [
  { id: 'clean', type: 'clean', targetSec: 3 },
  { id: 'draw', type: 'draw', targetSec: 3 },
  { id: 'stickers', type: 'stickers', targetSec: 3 },
  { id: 'reveal', type: 'reveal', targetSec: 2 },
];

export function ctx(): BuildContext {
  return { registry: bootstrap(), assets: loadAssets(fileURLToPath(new URL('../examples/assets', import.meta.url))) };
}

export function build(preset: 'onboard' | 'paywall', extra: Partial<NewProjectOptions> = {}) {
  const c = ctx();
  const p = newProject({ name: 't', preset, stages: STAGES, scenarioSource: '', ...extra }, c.assets);
  const report = rebuild(p, c);
  return { p, c, report };
}

export async function frameHashes(p: Project, c: BuildContext, scale = 0.25, guides = false): Promise<string[]> {
  const out: string[] = [];
  await renderTimeline(p, c, p.timeline!, { scale, guides, onFrame(s) { out.push(hashBytes(s.data)); } });
  return out;
}
