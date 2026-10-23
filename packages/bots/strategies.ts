import { round, dist, clamp } from '../core/index.ts';
import type { Registry } from '../core/index.ts';
import type { Game, Pt } from '../phonecase/index.ts';
import { distToRect } from '../phonecase/index.ts';
import type { DrawingData } from '../schema/index.ts';
import type { BotIntent } from './motion.ts';
import type { Bot } from './bot.ts';

/** A strategy decides WHAT to do next at the current stage (intent level, no timing). */
export interface BotStrategy {
  id: string;
  nextIntent(g: Game, bot: Bot): BotIntent | null;
}

// ───────────── clean: go to the biggest remaining dirt cluster, scrub it in a zigzag ─────────────
export const CleanStrategy: BotStrategy = {
  id: 'clean',
  nextIntent(g) {
    const L = g.layout;
    const c = L.caseRect;
    const B = 12;
    const bw = Math.ceil(g.gw / B);
    const bh = Math.ceil(g.gh / B);
    const diag = Math.sqrt(c.w * c.w + c.h * c.h);
    let best = -1;
    let bestScore = 0;
    let bb = { i0: 0, i1: 0, j0: 0, j1: 0, sum: 0 };
    for (let bj = 0; bj < bh; bj++) {
      for (let bi = 0; bi < bw; bi++) {
        let sum = 0;
        let i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1;
        for (let j = bj * B; j < Math.min(g.gh, (bj + 1) * B); j++) {
          for (let i = bi * B; i < Math.min(g.gw, (bi + 1) * B); i++) {
            const v = g.dirt[j * g.gw + i];
            if (v > 0) { sum += v; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
          }
        }
        if (sum === 0) continue;
        const cx = c.x + ((bi + 0.5) * B) * L.cell;
        const cy = c.y + ((bj + 0.5) * B) * L.cell;
        const d = Math.min(1, dist(g.pointer.x, g.pointer.y, cx, cy) / diag);
        const score = sum * (1 - 0.35 * d);
        if (score > bestScore) { bestScore = score; best = bj * bw + bi; bb = { i0, i1, j0, j1, sum }; }
      }
    }
    if (best < 0) return null;
    const r = L.toolR;
    let xa = c.x + bb.i0 * L.cell;
    let xb = c.x + (bb.i1 + 1) * L.cell;
    const ya = c.y + bb.j0 * L.cell;
    const yb = c.y + (bb.j1 + 1) * L.cell;
    if (xb - xa < r * 1.2) { const m = (xa + xb) / 2; xa = m - r * 0.6; xb = m + r * 0.6; }
    xa = clamp(xa - r * 0.3, c.x + 6, c.x + c.w - 6);
    xb = clamp(xb + r * 0.3, c.x + 6, c.x + c.w - 6);
    const spacing = r * 1.7;
    const rows = Math.max(1, Math.ceil((yb - ya) / spacing) + (yb - ya > spacing * 0.5 ? 1 : 0));
    const path: Pt[] = [];
    for (let k = 0; k < rows; k++) {
      const y = clamp(rows === 1 ? (ya + yb) / 2 : ya + (k * (yb - ya)) / (rows - 1), c.y + 6, c.y + c.h - 6);
      if (k % 2 === 0) { path.push({ x: xa, y }, { x: xb, y }); } else { path.push({ x: xb, y }, { x: xa, y }); }
    }
    return { kind: 'scrub', path, meta: { bbox: [Math.round(xa), Math.round(ya), Math.round(xb - xa), Math.round(yb - ya)], remaining: round(bb.sum / g.dirtSum0) } };
  },
};

// ───────────── draw: trace template strokes in order, redo weakly covered ones ─────────────
export const DrawStrategy: BotStrategy = {
  id: 'draw',
  nextIntent(g, bot) {
    const c = g.layout.caseRect;
    const strokes = (g.cfg.drawing.data as unknown as DrawingData).strokes;
    for (let si = 0; si < strokes.length; si++) {
      if (g.strokeCoverage(si) >= 0.9) continue;
      const key = 'draw.attempt.' + si;
      const attempt = bot.mem[key] ?? 0;
      if (attempt >= 3) continue;
      bot.mem[key] = attempt + 1;
      const path: Pt[] = strokes[si].points.map(([u, v]) => ({ x: c.x + u * c.w, y: c.y + v * c.h }));
      return { kind: 'stroke', path, meta: { stroke: si, attempt: attempt + 1, points: path.length } };
    }
    return null;
  },
};

// ───────────── stickers: drag from tray (maybe try a wrong spot first), then tap to fix ─────────────
export const StickersStrategy: BotStrategy = {
  id: 'stickers',
  nextIntent(g, bot) {
    const c = g.layout.caseRect;
    for (const s of g.stickers) {
      if (s.state === 'tray') {
        const cfg = g.cfg.stickers[s.i];
        const h = s.size / 2;
        const to: Pt = { x: clamp(c.x + cfg.u * c.w, c.x + h, c.x + c.w - h), y: clamp(c.y + cfg.v * c.h, c.y + h, c.y + c.h - h) };
        let decoy: Pt | null = null;
        if (bot.rng.chance(bot.persona.tryProb)) {
          decoy = { x: clamp(to.x + bot.rng.range(-70, 70), c.x + h, c.x + c.w - h), y: clamp(to.y + bot.rng.range(-60, 60), c.y + h, c.y + c.h - h) };
        }
        return { kind: 'drag', from: { x: s.x, y: s.y }, to, decoy, meta: { sticker: s.i, to: [Math.round(to.x), Math.round(to.y)], tried: decoy !== null } };
      }
    }
    for (const s of g.stickers) {
      if (s.state === 'placed') return { kind: 'tap', at: { x: s.x, y: s.y }, meta: { sticker: s.i } };
    }
    return null;
  },
};

// ───────────── reveal: take the tool away from the case and let the result sit ─────────────
export const RevealStrategy: BotStrategy = {
  id: 'reveal',
  nextIntent(g) {
    const away = !g.pointer.down && distToRect(g.pointer, g.layout.caseRect) >= 50;
    return away ? { kind: 'wait', ticks: 15, meta: {} } : { kind: 'exit', meta: {} };
  },
};

export function registerBotStrategies(reg: Registry): void {
  reg.register('botStrategy', 'clean', CleanStrategy);
  reg.register('botStrategy', 'draw', DrawStrategy);
  reg.register('botStrategy', 'stickers', StickersStrategy);
  reg.register('botStrategy', 'reveal', RevealStrategy);
}
