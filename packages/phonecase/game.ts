import { Rng, hashBytes, hashString, round, dist } from '../core/index.ts';
import type { Registry } from '../core/index.ts';
import type { Asset, DrawingData, GameEvent, EventType, PointerSample, Preset, Rect, StageDef, StickerData } from '../schema/index.ts';
import { computeLayout, inRect, sdRoundBox } from './layout.ts';
import type { Layout, Pt } from './layout.ts';

export interface StickerConfig { asset: Asset; u: number; v: number; scale: number; rot: number }

/** Everything that influences the simulation. Render-only data (background, case color) is NOT here. */
export interface GameConfig {
  preset: Preset;
  seed: number;
  dirtLevel: number;
  drawing: Asset;
  stickers: StickerConfig[];
  stages: StageDef[];
}

export interface Stroke { color: string; width: number; points: Array<[number, number]> }
export interface StickerState {
  i: number;
  state: 'tray' | 'dragging' | 'placed' | 'fixed';
  x: number;
  y: number;
  size: number;
  placedTick: number;
  fixedTick: number;
}

export type Edge = 'down' | 'up' | 'hold' | 'none';

export interface StageImpl {
  type: string;
  /** Data this stage depends on (assets, placements). Feeds the stage cache key: change it → stage is stale. */
  keyParts?(cfg: GameConfig): unknown;
  begin(g: Game): void;
  onPointer(g: Game, prev: PointerSample, cur: PointerSample, edge: Edge): void;
  progress(g: Game): number;
  done(g: Game): boolean;
}

interface TplSample { x: number; y: number; s: number }

export class Game {
  cfg: GameConfig;
  layout: Layout;
  registry: Registry;

  tick = 0;
  stageIndex = 0;
  finished = false;
  pointer: PointerSample;
  pointerDownTick = -1;
  sink: ((e: GameEvent) => void) | null = null;

  // ── scene state ──
  gw: number;
  gh: number;
  dirt: Uint8Array;
  dirtSum = 0;
  dirtSum0 = 0;
  touched: Int32Array;
  strokes: Stroke[] = [];
  active: Stroke | null = null;
  tpl: TplSample[] = [];
  tplCover: Uint8Array;
  tplCovered = 0;
  tplPerStroke: number[] = [];
  tplCoveredPerStroke: number[] = [];
  tplTol: number;
  stickers: StickerState[] = [];
  stageState: Record<string, number> = {};

  // ── event helpers ──
  actionKind: string | null = null;
  actionStartTick = 0;
  actionStartProgress = 0;
  changeAmt = 0;
  changeBox: Rect | null = null;
  stageImpls: StageImpl[] = [];

  constructor(cfg: GameConfig, registry: Registry) {
    this.cfg = cfg;
    this.registry = registry;
    this.layout = computeLayout(cfg.preset);
    const L = this.layout;
    this.pointer = { x: L.exitPoint.x, y: L.exitPoint.y, down: false };
    this.stageImpls = cfg.stages.map((s) => registry.get<StageImpl>('stageType', s.type));

    // dirt grid over the case bounding box
    const c = L.caseRect;
    this.gw = Math.ceil(c.w / L.cell);
    this.gh = Math.ceil(c.h / L.cell);
    this.dirt = new Uint8Array(this.gw * this.gh);
    this.touched = new Int32Array(this.gw * this.gh).fill(-1);
    this.initDirt();

    // drawing template → absolute points → resampled samples
    const drawing = cfg.drawing.data as unknown as DrawingData;
    this.tplTol = Math.round(L.toolR * 0.55);
    drawing.strokes.forEach((st, si) => {
      const abs: Pt[] = st.points.map(([u, v]) => ({ x: c.x + u * c.w, y: c.y + v * c.h }));
      const samples = resample(abs, 6);
      for (const p of samples) this.tpl.push({ x: p.x, y: p.y, s: si });
      this.tplPerStroke[si] = samples.length;
      this.tplCoveredPerStroke[si] = 0;
    });
    this.tplCover = new Uint8Array(this.tpl.length);

    // stickers start in the tray
    cfg.stickers.forEach((sc, i) => {
      const slot = L.tray[i];
      this.stickers.push({ i, state: 'tray', x: slot.x, y: slot.y, size: Math.round(L.slotSize * sc.scale), placedTick: -1, fixedTick: -1 });
    });
  }

  initDirt(): void {
    const L = this.layout;
    const c = L.caseRect;
    const rng = new Rng(this.cfg.seed).fork('dirt');
    const n = Math.round(8 + 12 * this.cfg.dirtLevel);
    const blobs: Array<{ x: number; y: number; r: number; s: number }> = [];
    for (let i = 0; i < n; i++) {
      blobs.push({ x: c.x + rng.range(0.14, 0.86) * c.w, y: c.y + rng.range(0.1, 0.9) * c.h, r: rng.range(0.06, 0.13) * c.w, s: rng.range(150, 255) });
    }
    const specks = Math.round(20 + 40 * this.cfg.dirtLevel);
    for (let i = 0; i < specks; i++) {
      blobs.push({ x: c.x + rng.range(0.08, 0.92) * c.w, y: c.y + rng.range(0.06, 0.94) * c.h, r: rng.range(4, 9), s: 210 });
    }
    let sum = 0;
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const x = c.x + (i + 0.5) * L.cell;
        const y = c.y + (j + 0.5) * L.cell;
        if (sdRoundBox(x, y, c.x + c.w / 2, c.y + c.h / 2, c.w / 2 - 6, c.h / 2 - 6, L.caseRadius) > 0) continue;
        let v = 0;
        for (const b of blobs) {
          const dx = x - b.x;
          const dy = y - b.y;
          const f = 1 - (dx * dx + dy * dy) / (b.r * b.r);
          if (f > 0) {
            const val = b.s * Math.min(1, f * 1.6);
            if (val > v) v = val;
          }
        }
        v = v < 24 ? 0 : Math.round(v);
        this.dirt[j * this.gw + i] = v;
        sum += v;
      }
    }
    this.dirtSum = sum;
    this.dirtSum0 = sum;
  }

  // ───────────── lifecycle ─────────────
  begin(): void {
    this.currentImpl().begin(this);
    this.emit('stage.started', { index: this.stageIndex });
  }
  currentStage(): StageDef { return this.cfg.stages[this.stageIndex]; }
  currentImpl(): StageImpl { return this.stageImpls[this.stageIndex]; }
  stageParam(name: string, def: number): number {
    const p = this.currentStage().params;
    return p && typeof p[name] === 'number' ? p[name] : def;
  }
  currentProgress(): number { return this.finished ? 1 : this.currentImpl().progress(this); }

  step(input: PointerSample): void {
    this.tick++;
    const prev = this.pointer;
    const cur: PointerSample = { x: input.x, y: input.y, down: input.down };
    if (this.finished) { this.pointer = cur; return; }
    const edge: Edge = cur.down && !prev.down ? 'down' : !cur.down && prev.down ? 'up' : cur.down ? 'hold' : 'none';
    if (edge === 'down') this.pointerDownTick = this.tick;
    const impl = this.currentImpl();
    impl.onPointer(this, prev, cur, edge);
    this.pointer = cur;
    if (this.actionKind && this.tick > this.actionStartTick && (this.tick - this.actionStartTick) % 6 === 0) {
      this.emit('action.progress', { action: this.actionKind, progress: round(impl.progress(this)) });
    }
    // A stage completes when its criterion is met AND the current action has ended (pointer up),
    // so a gesture is never cut in half and never leaks into the next stage.
    if (impl.done(this) && !cur.down) this.completeStage();
  }

  completeStage(): void {
    this.flushChange(true);
    if (this.actionKind) this.endAction({ auto: true });
    const hash = this.stateHash();
    this.emit('stage.completed', { index: this.stageIndex, stateHash: hash });
    if (this.stageIndex >= this.cfg.stages.length - 1) {
      this.finished = true;
      this.emit('result.ready', { stateHash: hash });
    } else {
      this.stageIndex++;
      this.stageState = {};
      this.currentImpl().begin(this);
      this.emit('stage.started', { index: this.stageIndex });
    }
  }

  // ───────────── events ─────────────
  emit(type: EventType, data: Record<string, unknown>): void {
    if (!this.sink) return;
    const st = this.currentStage();
    this.sink({ type, tick: this.tick, stageId: st.id, stageType: st.type, data });
  }
  beginAction(kind: string, data: Record<string, unknown> = {}): void {
    this.actionKind = kind;
    this.actionStartTick = this.tick;
    this.actionStartProgress = this.currentImpl().progress(this);
    this.emit('action.started', { action: kind, ...data });
  }
  endAction(data: Record<string, unknown> = {}): void {
    if (!this.actionKind) return;
    const p = this.currentImpl().progress(this);
    this.emit('action.completed', {
      action: this.actionKind,
      durationTicks: this.tick - this.actionStartTick,
      progressDelta: round(p - this.actionStartProgress),
      ...data,
    });
    this.actionKind = null;
  }
  /** Accumulate a visible change; emits `visual.change` when it becomes notable (or when forced). */
  markChange(box: Rect, amount: number, force = false): void {
    this.changeAmt += amount;
    this.changeBox = this.changeBox ? unionRect(this.changeBox, box) : box;
    if (force || this.changeAmt >= 0.05) this.flushChange(true);
  }
  flushChange(force: boolean): void {
    if (!force || this.changeAmt < 0.004 || !this.changeBox) { if (force) { this.changeAmt = 0; this.changeBox = null; } return; }
    const b = this.changeBox;
    this.emit('visual.change', {
      intensity: round(this.changeAmt),
      bbox: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)],
      progress: round(this.currentImpl().progress(this)),
    });
    this.changeAmt = 0;
    this.changeBox = null;
  }

  // ───────────── clean ─────────────
  stampDirt(a: Pt, b: Pt): void {
    const L = this.layout;
    const r = L.toolR;
    const c = L.caseRect;
    const len = dist(a.x, a.y, b.x, b.y);
    const n = Math.max(1, Math.ceil(len / (r * 0.5)));
    let removed = 0;
    for (let k = 0; k <= n; k++) {
      const t = n === 0 ? 0 : k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const i0 = Math.max(0, Math.floor((x - r - c.x) / L.cell));
      const i1 = Math.min(this.gw - 1, Math.floor((x + r - c.x) / L.cell));
      const j0 = Math.max(0, Math.floor((y - r - c.y) / L.cell));
      const j1 = Math.min(this.gh - 1, Math.floor((y + r - c.y) / L.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * this.gw + i;
          const v = this.dirt[idx];
          if (v === 0 || this.touched[idx] === this.tick) continue;
          const dx = c.x + (i + 0.5) * L.cell - x;
          const dy = c.y + (j + 0.5) * L.cell - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          this.touched[idx] = this.tick;
          const strength = d2 < r * r * 0.36 ? 90 : 45;
          const nv = v > strength ? v - strength : 0;
          this.dirt[idx] = nv;
          removed += v - nv;
        }
      }
    }
    if (removed > 0) {
      this.dirtSum -= removed;
      const x0 = Math.min(a.x, b.x) - r;
      const y0 = Math.min(a.y, b.y) - r;
      this.markChange({ x: x0, y: y0, w: Math.abs(a.x - b.x) + 2 * r, h: Math.abs(a.y - b.y) + 2 * r }, removed / this.dirtSum0);
    }
  }

  // ───────────── draw ─────────────
  nearestTplStroke(p: Pt): number {
    let best = 0;
    let bd = Infinity;
    for (const s of this.tpl) {
      const d = (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y);
      if (d < bd) { bd = d; best = s.s; }
    }
    return best;
  }
  startStroke(p: Pt): void {
    const tplStrokes = (this.cfg.drawing.data as unknown as DrawingData).strokes;
    const si = this.nearestTplStroke(p);
    this.active = { color: tplStrokes[si].color, width: tplStrokes[si].width, points: [[p.x, p.y]] };
    this.strokes.push(this.active);
    this.markTemplate(p, p);
  }
  extendStroke(p: Pt): void {
    const s = this.active;
    if (!s) return;
    const last = s.points[s.points.length - 1];
    if (dist(last[0], last[1], p.x, p.y) < 2) return;
    this.markTemplate({ x: last[0], y: last[1] }, p);
    s.points.push([p.x, p.y]);
  }
  markTemplate(a: Pt, b: Pt): void {
    const len = dist(a.x, a.y, b.x, b.y);
    const n = Math.max(1, Math.ceil(len / 4));
    const tol2 = this.tplTol * this.tplTol;
    let newly = 0;
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * (k / n);
      const y = a.y + (b.y - a.y) * (k / n);
      for (let i = 0; i < this.tpl.length; i++) {
        if (this.tplCover[i]) continue;
        const dx = this.tpl[i].x - x;
        const dy = this.tpl[i].y - y;
        if (dx * dx + dy * dy <= tol2) {
          this.tplCover[i] = 1;
          this.tplCovered++;
          this.tplCoveredPerStroke[this.tpl[i].s]++;
          newly++;
        }
      }
    }
    if (newly > 0) {
      const m = this.tplTol + 8;
      this.markChange({ x: Math.min(a.x, b.x) - m, y: Math.min(a.y, b.y) - m, w: Math.abs(a.x - b.x) + 2 * m, h: Math.abs(a.y - b.y) + 2 * m }, newly / this.tpl.length);
    }
  }
  strokeCoverage(si: number): number {
    return this.tplPerStroke[si] === 0 ? 1 : this.tplCoveredPerStroke[si] / this.tplPerStroke[si];
  }

  // ───────────── fingerprint ─────────────
  /**
   * Fingerprint of the COMMITTED state only. Data that is merely configuration of a later stage
   * (untouched drawing template, stickers still in the tray) is deliberately left out, so replacing a
   * later stage's asset does not change the fingerprint of an earlier stage that is still valid.
   */
  stateHash(): string {
    const meta = JSON.stringify({
      t: this.tick, si: this.stageIndex, f: this.finished, ss: this.stageState,
      st: this.stickers.filter((s) => s.state !== 'tray'), sk: this.strokes, p: this.pointer,
    });
    return hashString(meta + hashBytes(this.dirt) + (this.tplCovered > 0 ? hashBytes(this.tplCover) : ''));
  }
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Resample a polyline at a fixed step. */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length === 0) return [];
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = dist(a.x, a.y, b.x, b.y);
    if (L === 0) continue;
    let d = step - carry;
    while (d <= L) {
      out.push({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L });
      d += step;
    }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1];
  const lo = out[out.length - 1];
  if (dist(lo.x, lo.y, last.x, last.y) > step * 0.4) out.push({ x: last.x, y: last.y });
  return out;
}

export { inRect };
export type { StickerData };
