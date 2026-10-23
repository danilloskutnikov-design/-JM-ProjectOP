import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hashJson, hashString32 } from '../core/index.ts';
import type { Registry } from '../core/index.ts';
import { PRESETS } from '../schema/index.ts';
import type { Asset, Preset, Project, Rect, Scene, StageDef, StickerPlacement } from '../schema/index.ts';
import type { GameConfig, StageImpl } from '../phonecase/index.ts';

export type AssetMap = Record<string, Asset>;

export function loadAssets(dir: string): AssetMap {
  const out: AssetMap = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const a = JSON.parse(readFileSync(dir + '/' + f, 'utf8')) as Asset;
    out[a.id] = a;
  }
  return out;
}

export function assetHash(a: Asset): string { return hashJson(a.data); }

export function getAsset(assets: AssetMap, id: string, kind: Asset['kind']): Asset {
  const a = assets[id];
  if (!a) throw new Error(`asset "${id}" not found`);
  if (a.kind !== kind) throw new Error(`asset "${id}" is a ${a.kind}, expected ${kind}`);
  return a;
}

export const DEFAULT_PLACEMENTS: StickerPlacement[] = [
  { asset: 'sticker-star', u: 0.8, v: 0.09, scale: 1, rot: -0.2 },
  { asset: 'sticker-smile', u: 0.2, v: 0.94, scale: 1, rot: 0.15 },
  { asset: 'sticker-bolt', u: 0.8, v: 0.94, scale: 1, rot: 0.1 },
];

export interface NewProjectOptions {
  name: string;
  preset: 'onboard' | 'paywall';
  stages: StageDef[];
  scenarioSource: string;
  persona?: string;
  speed?: number;
  seed?: number;
  quietZone?: Rect | null;
  background?: string;
  drawing?: string;
  stickers?: StickerPlacement[];
  caseColor?: string;
  loop?: 'off' | 'cut';
}

export function newProject(o: NewProjectOptions, assets: AssetMap): Project {
  const preset: Preset = { ...PRESETS[o.preset], quietZone: o.quietZone ?? null };
  const scene: Scene = {
    seed: o.seed ?? 1,
    caseColor: o.caseColor ?? '#f4f1ea',
    dirtLevel: 0.35,
    background: o.background ?? 'bg-dots',
    drawing: o.drawing ?? 'drawing-heart-star',
    stickers: o.stickers ?? DEFAULT_PLACEMENTS,
  };
  const p: Project = {
    schemaVersion: 1,
    name: o.name,
    preset,
    scenario: { source: o.scenarioSource, stages: o.stages, speed: o.speed ?? 1, persona: o.persona ?? 'careful' },
    scene,
    assets: {},
    takes: [],
    timeline: null,
    loop: o.loop ?? 'cut',
    modLock: [],
  };
  refreshAssetHashes(p, assets);
  return p;
}

export function refreshAssetHashes(p: Project, assets: AssetMap): void {
  p.assets = {};
  const ids = [p.scene.background, p.scene.drawing, ...p.scene.stickers.map((s) => s.asset)];
  for (const id of ids) {
    const a = assets[id];
    if (a) p.assets[id] = { kind: a.kind, hash: assetHash(a) };
  }
}

/** Resolve a project + asset library into the simulation config. */
export function buildGameConfig(p: Project, assets: AssetMap): GameConfig {
  return {
    preset: p.preset,
    seed: p.scene.seed,
    dirtLevel: p.scene.dirtLevel,
    drawing: getAsset(assets, p.scene.drawing, 'drawing'),
    stickers: p.scene.stickers.map((s) => ({ asset: getAsset(assets, s.asset, 'sticker'), u: s.u, v: s.v, scale: s.scale, rot: s.rot })),
    stages: p.scenario.stages,
  };
}

/**
 * Chain-hashed cache key per stage. A stage key changes when the stage's own inputs change
 * OR when any earlier stage's inputs change (its starting state would differ).
 * Render-only data (background, case color, safe-zone guides, quiet zone, durations) is NOT in the key:
 * changing it needs a re-render, never a re-simulation.
 */
export function computeStageKeys(p: Project, cfg: GameConfig, registry: Registry): string[] {
  let key = hashJson({
    v: 1,
    w: p.preset.width, h: p.preset.height, insets: p.preset.insets,
    seed: p.scene.seed, dirt: p.scene.dirtLevel,
  });
  const keys: string[] = [];
  for (const st of p.scenario.stages) {
    const impl = registry.get<StageImpl>('stageType', st.type);
    key = hashJson({ prev: key, id: st.id, type: st.type, params: st.params ?? {}, parts: impl.keyParts ? impl.keyParts(cfg) : null });
    keys.push(key);
  }
  return keys;
}

export function seedForTake(p: Project, n: number): number {
  return hashString32(`${p.scene.seed}:take:${n}`);
}

export function saveProject(p: Project, path: string): void {
  writeFileSync(path, JSON.stringify(p) + '\n');
}
export function loadProject(path: string): Project {
  return JSON.parse(readFileSync(path, 'utf8')) as Project;
}

/** Structural check of an asset file. Returns a problem description or null. */
export function validateAssets(a: Asset): string | null {
  if (!a || typeof a.id !== 'string' || !a.id) return 'нет поля id';
  if (!['background', 'drawing', 'sticker'].includes(a.kind)) return `неизвестный kind «${String(a.kind)}»`;
  const d = a.data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object') return 'нет поля data';
  if (a.kind === 'drawing') {
    const st = d.strokes as unknown;
    if (!Array.isArray(st) || st.length === 0) return 'drawing: нужен непустой массив strokes';
    for (const s of st as Array<{ color?: unknown; width?: unknown; points?: unknown }>) {
      if (typeof s.color !== 'string' || typeof s.width !== 'number' || !Array.isArray(s.points) || s.points.length < 2) return 'drawing: штрих должен иметь color, width и ≥2 точек';
    }
  }
  if (a.kind === 'sticker' && (typeof d.shape !== 'string' || typeof d.color !== 'string')) return 'sticker: нужны shape и color';
  if (a.kind === 'background' && (typeof d.top !== 'string' || typeof d.bottom !== 'string')) return 'background: нужны top и bottom';
  return null;
}
