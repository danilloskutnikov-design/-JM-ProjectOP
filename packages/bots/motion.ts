import { Rng, clamp, lerp, minJerk, dist, log2, FPS } from '../core/index.ts';
import type { Pt, Layout } from '../phonecase/index.ts';
import type { PointerSample } from '../schema/index.ts';

export interface Persona {
  id: string;
  /** Typical working speed, px/s. */
  speed: number;
  /** Tremor amplitude (px, ~1σ) while the pointer is down. */
  tremor: number;
  /** Probability per second of a micro-pause while working. */
  pausePerSec: number;
  /** Hesitation (ticks) before pressing at a new place. */
  hesitation: [number, number];
  /** Probability to "try" a wrong spot before dropping a sticker. */
  tryProb: number;
  /** Probability to overshoot the target on a long approach and correct. */
  overshootProb: number;
}

export const PERSONAS: Persona[] = [
  { id: 'careful', speed: 380, tremor: 1.2, pausePerSec: 0.35, hesitation: [6, 14], tryProb: 0.55, overshootProb: 0.15 },
  { id: 'fast', speed: 650, tremor: 2.4, pausePerSec: 0.08, hesitation: [1, 4], tryProb: 0.1, overshootProb: 0.35 },
  { id: 'playful', speed: 500, tremor: 2.0, pausePerSec: 0.5, hesitation: [3, 20], tryProb: 0.8, overshootProb: 0.4 },
];

/** Smooth 1-D noise (value noise with smoothstep), consumed in increasing time order. */
export class NoiseTrack {
  rng: Rng;
  period: number;
  pts: number[] = [];
  constructor(rng: Rng, period: number) {
    this.rng = rng;
    this.period = period;
  }
  at(t: number): number {
    const f = t / this.period;
    const i = Math.floor(f);
    while (this.pts.length <= i + 1) this.pts.push(this.rng.normal() * 0.6);
    const u = f - i;
    const s = u * u * (3 - 2 * u);
    return this.pts[i] * (1 - s) + this.pts[i + 1] * s;
  }
}

export interface MotionCtx {
  rng: Rng;
  persona: Persona;
  speedMul: number;
  speedNoise: NoiseTrack;
  counter: number;
}

export type IntentKind = 'scrub' | 'stroke' | 'drag' | 'tap' | 'exit' | 'wait';
export interface BotIntent {
  kind: IntentKind;
  path?: Pt[];
  from?: Pt;
  to?: Pt;
  decoy?: Pt | null;
  at?: Pt;
  ticks?: number;
  /** Summary that goes to the intent log. */
  meta: Record<string, unknown>;
}

/** Fitts-style movement time: T = a + b·log2(D/W + 1), scaled by persona agility. */
export function fittsTicks(D: number, W: number, mc: MotionCtx): number {
  const agility = (mc.persona.speed / 500) * mc.speedMul;
  const sec = (0.1 + 0.14 * log2(D / Math.max(W, 1) + 1)) / agility;
  return Math.max(4, Math.round(sec * FPS));
}

function hover(out: PointerSample[], p: Pt, ticks: number, down: boolean): void {
  for (let i = 0; i < ticks; i++) out.push({ x: p.x, y: p.y, down });
}

/** Minimum-jerk travel with a slight curved bulge (humans don't move in straight lines). */
function travel(out: PointerSample[], a: Pt, b: Pt, ticks: number, down: boolean, mc: MotionCtx): void {
  const D = dist(a.x, a.y, b.x, b.y);
  if (D < 0.5) return;
  const nx = -(b.y - a.y) / D;
  const ny = (b.x - a.x) / D;
  const bulge = D * 0.05 * mc.rng.range(-1, 1);
  for (let i = 1; i <= ticks; i++) {
    const u = i / ticks;
    const s = minJerk(u);
    const w = 4 * u * (1 - u);
    out.push({ x: lerp(a.x, b.x, s) + nx * bulge * w, y: lerp(a.y, b.y, s) + ny * bulge * w, down });
  }
}

function approach(out: PointerSample[], from: Pt, to: Pt, W: number, mc: MotionCtx): void {
  const D = dist(from.x, from.y, to.x, to.y);
  if (D < 3) return;
  const total = fittsTicks(D, W, mc);
  if (D > 80 && mc.rng.chance(mc.persona.overshootProb)) {
    const k = mc.rng.range(8, 16) / D;
    const over: Pt = { x: to.x + (to.x - from.x) * k, y: to.y + (to.y - from.y) * k };
    travel(out, from, over, Math.max(3, Math.round(total * 0.85)), false, mc);
    travel(out, over, to, Math.max(4, Math.round(total * 0.2)), false, mc);
  } else {
    travel(out, from, to, total, false, mc);
  }
}

/** Walk a polyline at persona speed with slow speed variation and occasional micro-pauses. */
function follow(out: PointerSample[], pts: Pt[], mc: MotionCtx, factor = 1): void {
  if (pts.length < 2) return;
  const v = mc.persona.speed * mc.speedMul * factor;
  let seg = 0;
  let pos = 0;
  const last = pts.length - 1;
  while (seg < last) {
    const step = (v * (1 + 0.18 * mc.speedNoise.at(mc.counter++))) / FPS;
    let remain = step;
    while (remain > 0 && seg < last) {
      const L = dist(pts[seg].x, pts[seg].y, pts[seg + 1].x, pts[seg + 1].y);
      const left = L - pos;
      if (remain >= left) { remain -= left; seg++; pos = 0; } else { pos += remain; remain = 0; }
    }
    let p: Pt;
    if (seg >= last) p = pts[last];
    else {
      const L = dist(pts[seg].x, pts[seg].y, pts[seg + 1].x, pts[seg + 1].y);
      const u = L === 0 ? 0 : pos / L;
      p = { x: lerp(pts[seg].x, pts[seg + 1].x, u), y: lerp(pts[seg].y, pts[seg + 1].y, u) };
    }
    out.push({ x: p.x, y: p.y, down: true });
    if (mc.rng.next() < mc.persona.pausePerSec / FPS) hover(out, p, mc.rng.int(3, 9), true);
  }
}

export function planMotion(intent: BotIntent, from: Pt, mc: MotionCtx, L: Layout): PointerSample[] {
  const out: PointerSample[] = [];
  const P = mc.persona;
  switch (intent.kind) {
    case 'scrub':
    case 'stroke': {
      const pts = intent.path!;
      const start = pts[0];
      approach(out, from, start, L.toolR * 2, mc);
      hover(out, start, mc.rng.int(P.hesitation[0], P.hesitation[1]), false);
      hover(out, start, 2, true);
      // scrubbing is a quick back-and-forth; drawing follows a line more carefully
      follow(out, pts, mc, intent.kind === 'scrub' ? 1.8 : 1);
      hover(out, pts[pts.length - 1], 1, false);
      break;
    }
    case 'drag': {
      const a = intent.from!;
      const b = intent.to!;
      approach(out, from, a, L.slotSize, mc);
      hover(out, a, mc.rng.int(P.hesitation[0], P.hesitation[1]), false);
      hover(out, a, 3, true);
      let cur = a;
      if (intent.decoy) {
        travel(out, cur, intent.decoy, fittsTicks(dist(cur.x, cur.y, intent.decoy.x, intent.decoy.y), L.slotSize, mc), true, mc);
        hover(out, intent.decoy, mc.rng.int(5, 12), true);
        cur = intent.decoy;
      }
      travel(out, cur, b, fittsTicks(dist(cur.x, cur.y, b.x, b.y), L.slotSize * 0.8, mc), true, mc);
      hover(out, b, mc.rng.int(4, 8), true);
      hover(out, b, 1, false);
      break;
    }
    case 'tap': {
      const at = intent.at!;
      approach(out, from, at, L.slotSize * 0.6, mc);
      hover(out, at, mc.rng.int(2, 6), false);
      hover(out, at, 3, true);
      hover(out, at, 1, false);
      break;
    }
    case 'exit': {
      const to = L.exitPoint;
      travel(out, from, to, fittsTicks(dist(from.x, from.y, to.x, to.y), 120, mc), false, mc);
      hover(out, to, 3, false);
      break;
    }
    case 'wait':
      hover(out, from, intent.ticks ?? 10, false);
      break;
  }
  return out;
}

export { clamp };
