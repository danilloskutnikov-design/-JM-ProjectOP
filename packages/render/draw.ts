import { PI, cos, sin, hashString } from '../core/index.ts';
import type { Game } from '../phonecase/index.ts';
import type { BackgroundData, Rect, StickerData } from '../schema/index.ts';
import { Surface, capsule, darken, fillCircle, fillPolygon, fillRoundBox, mix, parseColor, ringCircle, sdRoundBoxPx } from './surface.ts';
import type { RGB } from './surface.ts';

/** Render-only data: changing it never requires re-simulation. */
export interface RenderStyle {
  caseColor: string;
  background: BackgroundData;
  quietZone: Rect | null;
}
export interface RenderOptions {
  /** Safe-zone / quiet-zone guides. Preview only — never enabled for export. */
  guides: boolean;
}

// ───────────── static layer (background + case body), cached per size/style ─────────────
interface StaticLayer { key: string; surface: Surface; mask: Float32Array; bx0: number; by0: number; bw: number; bh: number }
let staticCache: StaticLayer | null = null;

function buildStatic(g: Game, style: RenderStyle, W: number, H: number): StaticLayer {
  const key = hashString(JSON.stringify([W, H, style.caseColor, style.background, g.cfg.preset.width, g.cfg.preset.height, g.layout.caseRect]));
  if (staticCache && staticCache.key === key) return staticCache;
  const k = W / g.cfg.preset.width;
  const L = g.layout;
  const s = new Surface(W, H);
  const top = parseColor(style.background.top);
  const bot = parseColor(style.background.bottom);
  const dotC = style.background.dots ? parseColor(style.background.dots) : null;
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const rc = mix(top, bot, t);
    for (let x = 0; x < W; x++) {
      let r = rc[0], gg = rc[1], b = rc[2];
      if (dotC) {
        const u = x / k / 56;
        const v = y / k / 56;
        const row = Math.floor(v);
        const su = u + (row % 2 === 0 ? 0 : 0.5);
        const fx = su - Math.floor(su) - 0.5;
        const fy = v - row - 0.5;
        const d = Math.sqrt(fx * fx + fy * fy) * 56 * k;
        const a = Math.max(0, Math.min(1, 7 * k - d)) * 0.14;
        if (a > 0) { r += (dotC[0] - r) * a; gg += (dotC[1] - gg) * a; b += (dotC[2] - b) * a; }
      }
      const i = (y * W + x) * 4;
      s.data[i] = r; s.data[i + 1] = gg; s.data[i + 2] = b; s.data[i + 3] = 255;
    }
  }
  const c = L.caseRect;
  const cx = (c.x + c.w / 2) * k;
  const cy = (c.y + c.h / 2) * k;
  const hw = (c.w / 2) * k;
  const hh = (c.h / 2) * k;
  const rad = L.caseRadius * k;
  const body = parseColor(style.caseColor);
  const edge = darken(body, 0.82);
  const m = 40 * k;
  const bx0 = Math.max(0, Math.floor(cx - hw - m));
  const by0 = Math.max(0, Math.floor(cy - hh - m));
  const bx1 = Math.min(W - 1, Math.ceil(cx + hw + m));
  const by1 = Math.min(H - 1, Math.ceil(cy + hh + m));
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  const mask = new Float32Array(bw * bh);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const sdS = sdRoundBoxPx(x + 0.5, y + 0.5 - 14 * k, cx, cy, hw, hh, rad);
      const sh = 0.42 * (1 - Math.max(0, Math.min(1, sdS / (30 * k))));
      if (sh > 0) s.px(x, y, 0, 0, 0, sh);
      const sd = sdRoundBoxPx(x + 0.5, y + 0.5, cx, cy, hw, hh, rad);
      const a = Math.max(0, Math.min(1, 0.5 - sd));
      mask[(y - by0) * bw + (x - bx0)] = a;
      if (a > 0) {
        const t = (y - (cy - hh)) / (2 * hh);
        let col: RGB = mix(body, [255, 255, 255], 0.1 * (1 - t));
        const rim = Math.max(0, Math.min(1, 1 - (-sd) / (3 * k)));
        col = mix(col, edge, rim * 0.9);
        s.px(x, y, col[0], col[1], col[2], a);
      }
    }
  }
  // camera bump
  const bump: RGB = [40, 42, 58];
  const bcx = (c.x + c.w * 0.3) * k;
  const bcy = (c.y + c.h * 0.075) * k;
  fillRoundBox(s, bcx, bcy, c.w * 0.2 * k, c.h * 0.05 * k, c.w * 0.08 * k, bump, 1);
  fillCircle(s, bcx - c.w * 0.09 * k, bcy, c.w * 0.055 * k, [90, 96, 120], 1);
  fillCircle(s, bcx + c.w * 0.09 * k, bcy, c.w * 0.055 * k, [90, 96, 120], 1);
  fillCircle(s, bcx - c.w * 0.09 * k, bcy, c.w * 0.03 * k, [15, 16, 24], 1);
  fillCircle(s, bcx + c.w * 0.09 * k, bcy, c.w * 0.03 * k, [15, 16, 24], 1);
  staticCache = { key, surface: s, mask, bx0, by0, bw, bh };
  return staticCache;
}

// ───────────── shapes ─────────────
type Poly = Array<[number, number]>;
const STAR: Poly = (() => {
  const p: Poly = [];
  for (let i = 0; i < 10; i++) { const a = -PI / 2 + (i * PI) / 5; const r = i % 2 === 0 ? 1 : 0.45; p.push([r * cos(a), r * sin(a)]); }
  return p;
})();
const HEART: Poly = (() => {
  const p: Poly = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * 2 * PI;
    const x = 16 * sin(t) * sin(t) * sin(t);
    const y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t);
    p.push([x / 16, -y / 16 + 0.05]);
  }
  return p;
})();
const BOLT: Poly = [[0.25, -1], [-0.55, 0.15], [-0.08, 0.15], [-0.25, 1], [0.55, -0.2], [0.08, -0.2], [0.45, -1]];

function drawSticker(s: Surface, shape: string, color: RGB, cx: number, cy: number, r: number, rot: number, k: number): void {
  const co = cos(rot);
  const si = sin(rot);
  const tf = (poly: Poly): Poly => poly.map(([x, y]) => [cx + (x * co - y * si) * r, cy + (x * si + y * co) * r]);
  const ol = darken(color, 0.62);
  const w = 3 * k;
  switch (shape) {
    case 'star': fillPolygon(s, tf(STAR), color, w, ol); break;
    case 'heart': fillPolygon(s, tf(HEART), color, w, ol); break;
    case 'bolt': fillPolygon(s, tf(BOLT), color, w, ol); break;
    case 'smile': {
      fillCircle(s, cx, cy, r + w, ol);
      fillCircle(s, cx, cy, r, color);
      const eye = (ex: number) => fillCircle(s, cx + (ex * co + 0.25 * si) * r, cy + (ex * si - 0.25 * co) * r, r * 0.11, [60, 40, 20]);
      eye(-0.32); eye(0.32);
      for (let i = 0; i < 8; i++) {
        const a0 = 0.25 * PI + (i * 0.5 * PI) / 8;
        const a1 = 0.25 * PI + ((i + 1) * 0.5 * PI) / 8;
        const p0: [number, number] = [cos(a0) * 0.5, sin(a0) * 0.5 - 0.05];
        const p1: [number, number] = [cos(a1) * 0.5, sin(a1) * 0.5 - 0.05];
        capsule(s, cx + (p0[0] * co - p0[1] * si) * r, cy + (p0[0] * si + p0[1] * co) * r, cx + (p1[0] * co - p1[1] * si) * r, cy + (p1[0] * si + p1[1] * co) * r, r * 0.06, [60, 40, 20]);
      }
      break;
    }
    default:
      fillCircle(s, cx, cy, r + w, ol);
      fillCircle(s, cx, cy, r, color);
      fillCircle(s, cx - r * 0.3, cy - r * 0.3, r * 0.25, mix(color, [255, 255, 255], 0.5), 0.8);
  }
}

const hash2 = (x: number, y: number): number => (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) & 255) / 255;

// ───────────── frame ─────────────
export function renderFrame(out: Surface, g: Game, style: RenderStyle, opts: RenderOptions): void {
  const W = out.w;
  const H = out.h;
  const k = W / g.cfg.preset.width;
  const L = g.layout;
  const st = buildStatic(g, style, W, H);
  out.copyFrom(st.surface);
  const c = L.caseRect;
  const stageType = g.currentStage().type;

  // dirt (bilinear sample of the grid)
  const cellPx = L.cell * k;
  for (let y = st.by0; y < st.by0 + st.bh; y++) {
    const gy = (y + 0.5 - c.y * k) / cellPx - 0.5;
    if (gy < -1 || gy > g.gh) continue;
    const j0 = Math.floor(gy);
    const fy = gy - j0;
    for (let x = st.bx0; x < st.bx0 + st.bw; x++) {
      const m = st.mask[(y - st.by0) * st.bw + (x - st.bx0)];
      if (m <= 0) continue;
      const gx = (x + 0.5 - c.x * k) / cellPx - 0.5;
      if (gx < -1 || gx > g.gw) continue;
      const i0 = Math.floor(gx);
      const fx = gx - i0;
      let v = 0;
      for (let dj = 0; dj < 2; dj++) {
        const jj = j0 + dj;
        if (jj < 0 || jj >= g.gh) continue;
        for (let di = 0; di < 2; di++) {
          const ii = i0 + di;
          if (ii < 0 || ii >= g.gw) continue;
          v += g.dirt[jj * g.gw + ii] * (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
        }
      }
      if (v < 6) continue;
      const n = hash2(x >> 1, y >> 1);
      const t = Math.min(1, v / 255);
      const col = mix([120, 92, 52], [62, 44, 24], 0.35 * n + 0.5 * t);
      out.px(x, y, col[0], col[1], col[2], Math.min(0.92, t * 1.05) * m);
    }
  }

  // template guide (only while drawing)
  if (stageType === 'draw' && !g.finished) {
    for (let i = 0; i < g.tpl.length; i += 2) {
      if (g.tplCover[i]) continue;
      fillCircle(out, g.tpl[i].x * k, g.tpl[i].y * k, 2.6 * k, [90, 80, 70], 0.4);
    }
  }
  // strokes
  for (const sk of g.strokes) {
    const col = parseColor(sk.color);
    const r = (sk.width / 2) * k;
    if (sk.points.length === 1) fillCircle(out, sk.points[0][0] * k, sk.points[0][1] * k, r, col);
    for (let i = 1; i < sk.points.length; i++) {
      capsule(out, sk.points[i - 1][0] * k, sk.points[i - 1][1] * k, sk.points[i][0] * k, sk.points[i][1] * k, r, col);
    }
  }

  // sticker tray (only while stickers are waiting)
  const waiting = g.stickers.some((s) => s.state === 'tray' || s.state === 'dragging');
  if (waiting) {
    const t = L.trayRect;
    fillRoundBox(out, (t.x + t.w / 2) * k, (t.y + t.h / 2) * k, (t.w / 2) * k, (t.h / 2) * k, 22 * k, [255, 255, 255], 0.16);
    for (let i = 0; i < g.stickers.length; i++) {
      ringCircle(out, L.tray[i].x * k, L.tray[i].y * k, (L.slotSize / 2) * k, 2 * k, [255, 255, 255], 0.35);
    }
  }
  // stickers
  for (const s of g.stickers) {
    const cfg = g.cfg.stickers[s.i];
    const data = cfg.asset.data as unknown as StickerData;
    const col = parseColor(data.color);
    let scale = 1;
    let rot = 0;
    if (s.state === 'dragging') { scale = 1.12; rot = cfg.rot * 0.5; }
    if (s.state === 'placed' || s.state === 'fixed') {
      rot = cfg.rot;
      const age = g.tick - s.placedTick;
      if (age >= 0 && age < 10) { const u = age / 10; scale = 1 + 0.28 * 4 * u * (1 - u); }
      if (s.state === 'fixed') {
        const fa = g.tick - s.fixedTick;
        if (fa >= 0 && fa < 12) ringCircle(out, s.x * k, s.y * k, (s.size / 2 + 6 + fa * 3) * k, 3 * k, [255, 255, 255], 0.7 * (1 - fa / 12));
      }
    }
    if (s.state === 'dragging') fillCircle(out, s.x * k, (s.y + 10) * k, (s.size / 2) * k, [0, 0, 0], 0.22);
    drawSticker(out, data.shape, col, s.x * k, s.y * k, (s.size / 2) * 0.9 * scale * k, rot, k);
  }

  // result shine at the start of the reveal hold
  if (stageType === 'reveal') {
    const age = g.stageState.hold ?? 0;
    if (age > 0 && age <= 26) {
      const pos = (age / 26) * 1.5 - 0.25;
      for (let y = st.by0; y < st.by0 + st.bh; y++) {
        for (let x = st.bx0; x < st.bx0 + st.bw; x++) {
          const m = st.mask[(y - st.by0) * st.bw + (x - st.bx0)];
          if (m <= 0) continue;
          const t = ((x / k - c.x) + (y / k - c.y) * 0.5) / (c.w + c.h * 0.5);
          const a = Math.max(0, 1 - Math.abs(t - pos) / 0.1) * 0.5 * m;
          if (a > 0) out.px(x, y, 255, 255, 255, a);
        }
      }
    }
  }

  // tool / finger
  const p = g.pointer;
  if (p.x > -60 && p.x < g.cfg.preset.width + 60 && !(stageType === 'reveal' && (g.stageState.hold ?? 0) > 0 && !p.down && p.x > g.cfg.preset.width)) {
    const px = p.x * k;
    const py = p.y * k;
    if (stageType === 'clean') {
      ringCircle(out, px, py, L.toolR * k, 2 * k, [255, 255, 255], 0.35);
      fillRoundBox(out, px + 8 * k, py + 6 * k, 34 * k, 22 * k, 10 * k, [0, 0, 0], 0.18);
      fillRoundBox(out, px, py, 34 * k, 22 * k, 10 * k, [255, 214, 64], 1);
      for (let i = -1; i <= 1; i++) fillCircle(out, px + i * 14 * k, py - 3 * k, 3 * k, [214, 160, 20], 0.9);
    } else if (stageType === 'draw' && p.down && g.active) {
      fillCircle(out, px, py, 10 * k, parseColor(g.active.color));
      ringCircle(out, px, py, 14 * k, 3 * k, [255, 255, 255], 0.9);
    } else {
      fillCircle(out, px, py + 6 * k, 24 * k, [0, 0, 0], 0.16);
      fillCircle(out, px, py, 22 * k, [255, 255, 255], p.down ? 0.8 : 0.55);
      ringCircle(out, px, py, 22 * k, 2.5 * k, [255, 255, 255], 0.95);
    }
    const age = g.tick - g.pointerDownTick;
    if (p.down && age >= 0 && age < 10) ringCircle(out, px, py, (14 + age * 3) * k, 3 * k, [255, 255, 255], 0.8 * (1 - age / 10));
  }

  if (opts.guides) drawGuides(out, g, style);
}

function drawGuides(out: Surface, g: Game, style: RenderStyle): void {
  const k = out.w / g.cfg.preset.width;
  const sr = g.layout.safe;
  const x0 = sr.x * k, y0 = sr.y * k, x1 = (sr.x + sr.w) * k, y1 = (sr.y + sr.h) * k;
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) out.px(x, y, 0, 0, 0, 0.28);
    }
  }
  const col: RGB = [0, 229, 255];
  const t = Math.max(2, 2 * k);
  capsule(out, x0, y0, x1, y0, t / 2, col); capsule(out, x1, y0, x1, y1, t / 2, col);
  capsule(out, x1, y1, x0, y1, t / 2, col); capsule(out, x0, y1, x0, y0, t / 2, col);
  const q = style.quietZone;
  if (q) {
    const qc: RGB = [255, 0, 170];
    const a0 = q.x * k, b0 = q.y * k, a1 = (q.x + q.w) * k, b1 = (q.y + q.h) * k;
    for (let y = Math.max(0, Math.floor(b0)); y < Math.min(out.h, b1); y++) for (let x = Math.max(0, Math.floor(a0)); x < Math.min(out.w, a1); x++) out.px(x, y, qc[0], qc[1], qc[2], 0.18);
    capsule(out, a0, b0, a1, b0, t / 2, qc); capsule(out, a1, b0, a1, b1, t / 2, qc);
    capsule(out, a1, b1, a0, b1, t / 2, qc); capsule(out, a0, b1, a0, b0, t / 2, qc);
  }
}
