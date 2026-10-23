import { mkdirSync } from 'node:fs';
import { PRESETS } from '../schema/index.ts';
import type { Project, Rect } from '../schema/index.ts';
import { rebuild } from './build.ts';
import type { BuildContext, BuildReport } from './build.ts';
import { exportMp4 } from './render.ts';
import type { ExportReport } from './render.ts';

export interface Variant {
  name: string;
  preset?: 'onboard' | 'paywall';
  quietZone?: Rect | null;
  background?: string;
  drawing?: string;
  stickers?: string[];
  caseColor?: string;
  persona?: string;
  scale?: number;
}
export interface BatchItem { name: string; build: BuildReport; export: ExportReport }

/**
 * Build several variants of one project. Each variant starts from a copy of the base project,
 * so unchanged stages are reused (e.g. a new background re-renders only), while changed inputs
 * re-simulate only what they affect.
 */
export async function exportBatch(base: Project, ctx: BuildContext, variants: Variant[], outDir: string): Promise<BatchItem[]> {
  mkdirSync(outDir, { recursive: true });
  const out: BatchItem[] = [];
  for (const v of variants) {
    const p: Project = structuredClone(base);
    if (v.preset && v.preset !== p.preset.id) {
      p.preset = { ...PRESETS[v.preset], quietZone: v.quietZone ?? null };
      p.takes = []; // different frame size → different layout → nothing is reusable
    } else if (v.quietZone !== undefined) p.preset.quietZone = v.quietZone;
    if (v.background) p.scene.background = v.background;
    if (v.drawing) p.scene.drawing = v.drawing;
    if (v.caseColor) p.scene.caseColor = v.caseColor;
    if (v.persona) p.scenario.persona = v.persona;
    if (v.stickers) p.scene.stickers = v.stickers.map((a, i) => ({ ...p.scene.stickers[i % p.scene.stickers.length], asset: a }));
    const build = rebuild(p, ctx);
    const exp = await exportMp4(p, ctx, `${outDir}/${v.name}.mp4`, v.scale ?? 1);
    out.push({ name: v.name, build, export: exp });
  }
  return out;
}
