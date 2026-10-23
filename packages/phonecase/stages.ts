import type { Registry } from '../core/index.ts';
import { dist } from '../core/index.ts';
import type { PointerSample } from '../schema/index.ts';
import { distToRect, inRect } from './layout.ts';
import type { Game, StageImpl, Edge } from './game.ts';

// ───────────── clean ─────────────
export const CleanStage: StageImpl = {
  type: 'clean',
  begin() {},
  onPointer(g: Game, prev: PointerSample, cur: PointerSample, edge: Edge) {
    if (edge === 'down') g.beginAction('scrub', { x: Math.round(cur.x), y: Math.round(cur.y) });
    if (cur.down) g.stampDirt(edge === 'down' ? cur : prev, cur);
    if (edge === 'up') g.endAction({});
  },
  progress(g: Game) { return 1 - g.dirtSum / g.dirtSum0; },
  done(g: Game) { return CleanStage.progress(g) >= g.stageParam('cleanThreshold', 0.94); },
};

// ───────────── draw ─────────────
export const DrawStage: StageImpl = {
  type: 'draw',
  keyParts(cfg) { return cfg.drawing.data; },
  begin() {},
  onPointer(g: Game, _prev: PointerSample, cur: PointerSample, edge: Edge) {
    if (edge === 'down') g.beginAction('stroke', { x: Math.round(cur.x), y: Math.round(cur.y) });
    if (cur.down) {
      if (!inRect(cur, g.layout.caseRect)) g.active = null;
      else if (!g.active) g.startStroke(cur);
      else g.extendStroke(cur);
    }
    if (edge === 'up') { g.active = null; g.endAction({}); }
  },
  // every template stroke counts equally: a short stroke can't hide inside the "missing 10%"
  progress(g: Game) {
    const n = g.tplPerStroke.length;
    if (n === 0) return 1;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += g.strokeCoverage(i);
    return sum / n;
  },
  done(g: Game) {
    const th = g.stageParam('drawThreshold', 0.9);
    for (let i = 0; i < g.tplPerStroke.length; i++) if (g.strokeCoverage(i) < th) return false;
    return true;
  },
};

// ───────────── stickers ─────────────
export const StickersStage: StageImpl = {
  type: 'stickers',
  keyParts(cfg) { return cfg.stickers.map((s) => ({ data: s.asset.data, u: s.u, v: s.v, scale: s.scale, rot: s.rot })); },
  begin(g: Game) { g.stageState = { drag: -1, tap: -1, tapTick: 0, tapX: 0, tapY: 0 }; },
  onPointer(g: Game, _prev: PointerSample, cur: PointerSample, edge: Edge) {
    const S = g.stickers;
    const ss = g.stageState;
    const n = Math.max(1, S.length);
    if (edge === 'down') {
      let idx = -1;
      for (const s of S) if (s.state === 'tray' && dist(cur.x, cur.y, s.x, s.y) <= s.size * 0.6) { idx = s.i; break; }
      if (idx >= 0) {
        S[idx].state = 'dragging';
        ss.drag = idx;
        g.beginAction('drag', { sticker: idx });
      } else {
        for (const s of S) {
          if (s.state === 'placed' && dist(cur.x, cur.y, s.x, s.y) <= s.size * 0.6) {
            ss.tap = s.i; ss.tapTick = g.tick; ss.tapX = cur.x; ss.tapY = cur.y;
            g.beginAction('tap', { sticker: s.i });
            break;
          }
        }
      }
    }
    if (cur.down && ss.drag >= 0) { S[ss.drag].x = cur.x; S[ss.drag].y = cur.y; }
    if (edge === 'up') {
      if (ss.drag >= 0) {
        const s = S[ss.drag];
        const c = g.layout.caseRect;
        const placed = inRect(cur, c);
        if (placed) {
          const h = s.size / 2;
          s.x = Math.min(Math.max(cur.x, c.x + h), c.x + c.w - h);
          s.y = Math.min(Math.max(cur.y, c.y + h), c.y + c.h - h);
          s.state = 'placed';
          s.placedTick = g.tick;
          g.markChange({ x: s.x - h, y: s.y - h, w: s.size, h: s.size }, 0.5 / n, true);
        } else {
          const slot = g.layout.tray[s.i];
          s.state = 'tray'; s.x = slot.x; s.y = slot.y;
        }
        const idx = ss.drag;
        ss.drag = -1;
        g.endAction({ sticker: idx, placed });
      } else if (ss.tap >= 0) {
        const s = S[ss.tap];
        const ok = g.tick - ss.tapTick <= 14 && dist(cur.x, cur.y, ss.tapX, ss.tapY) <= 12;
        if (ok) {
          s.state = 'fixed';
          s.fixedTick = g.tick;
          const h = s.size / 2;
          g.markChange({ x: s.x - h, y: s.y - h, w: s.size, h: s.size }, 0.5 / n, true);
        }
        const idx = ss.tap;
        ss.tap = -1;
        g.endAction({ sticker: idx, fixed: ok });
      }
    }
  },
  progress(g: Game) {
    if (g.stickers.length === 0) return 1;
    let sum = 0;
    for (const s of g.stickers) sum += s.state === 'fixed' ? 1 : s.state === 'placed' ? 0.5 : 0;
    return sum / g.stickers.length;
  },
  done(g: Game) { return g.stickers.every((s) => s.state === 'fixed'); },
};

// ───────────── reveal ─────────────
export const RevealStage: StageImpl = {
  type: 'reveal',
  begin(g: Game) { g.stageState = { hold: 0 }; },
  onPointer(g: Game, _prev: PointerSample, cur: PointerSample) {
    const away = !cur.down && distToRect(cur, g.layout.caseRect) >= 50;
    if (away) {
      if (g.stageState.hold === 0) g.beginAction('hold');
      g.stageState.hold++;
    } else {
      if (g.stageState.hold > 0) g.endAction({ canceled: true });
      g.stageState.hold = 0;
    }
  },
  progress(g: Game) { return Math.min(1, g.stageState.hold / g.stageParam('revealHoldTicks', 45)); },
  done(g: Game) { return g.stageState.hold >= g.stageParam('revealHoldTicks', 45); },
};

export function registerPhoneCase(reg: Registry): void {
  reg.register('stageType', 'clean', CleanStage);
  reg.register('stageType', 'draw', DrawStage);
  reg.register('stageType', 'stickers', StickersStage);
  reg.register('stageType', 'reveal', RevealStage);
}
