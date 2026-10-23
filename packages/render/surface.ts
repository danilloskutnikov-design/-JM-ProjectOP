/** RGBA pixel buffer + small set of anti-aliased primitives. Pure JS: runs in Node and in the browser. */
export class Surface {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  copyFrom(o: Surface): void { this.data.set(o.data); }
  /** Source-over blend onto an opaque pixel. a in 0..1 */
  px(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    if (a >= 1) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    d[i] = d[i] + (r - d[i]) * a;
    d[i + 1] = d[i + 1] + (g - d[i + 1]) * a;
    d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
    d[i + 3] = 255;
  }
}

export type RGB = [number, number, number];

export function parseColor(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function darken(c: RGB, f: number): RGB { return [c[0] * f, c[1] * f, c[2] * f]; }

const cl01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function fillCircle(s: Surface, cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(s.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(s.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const a = cl01(r + 0.5 - Math.sqrt(dx * dx + dy * dy)) * alpha;
      if (a > 0) s.px(x, y, c[0], c[1], c[2], a);
    }
  }
}
export function ringCircle(s: Surface, cx: number, cy: number, r: number, thick: number, c: RGB, alpha = 1): void {
  const R = r + thick / 2 + 1;
  const x0 = Math.max(0, Math.floor(cx - R));
  const x1 = Math.min(s.w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(s.h - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const a = cl01(thick / 2 + 0.5 - Math.abs(Math.sqrt(dx * dx + dy * dy) - r)) * alpha;
      if (a > 0) s.px(x, y, c[0], c[1], c[2], a);
    }
  }
}
/** Round-capped line segment. */
export function capsule(s: Surface, ax: number, ay: number, bx: number, by: number, r: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
  const x1 = Math.min(s.w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
  const y1 = Math.min(s.h - 1, Math.ceil(Math.max(ay, by) + r + 1));
  const ex = bx - ax;
  const ey = by - ay;
  const L2 = ex * ex + ey * ey;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wx = x + 0.5 - ax;
      const wy = y + 0.5 - ay;
      let t = L2 === 0 ? 0 : (wx * ex + wy * ey) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      const a = cl01(r + 0.5 - Math.sqrt(dx * dx + dy * dy)) * alpha;
      if (a > 0) s.px(x, y, c[0], c[1], c[2], a);
    }
  }
}
export function sdRoundBoxPx(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
export function fillRoundBox(s: Surface, cx: number, cy: number, hw: number, hh: number, r: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(cx - hw - 1));
  const x1 = Math.min(s.w - 1, Math.ceil(cx + hw + 1));
  const y0 = Math.max(0, Math.floor(cy - hh - 1));
  const y1 = Math.min(s.h - 1, Math.ceil(cy + hh + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = cl01(0.5 - sdRoundBoxPx(x + 0.5, y + 0.5, cx, cy, hw, hh, r)) * alpha;
      if (a > 0) s.px(x, y, c[0], c[1], c[2], a);
    }
  }
}
/** Signed distance to a polygon (negative inside). */
export function sdPolygon(px: number, py: number, v: Array<[number, number]>): number {
  const n = v.length;
  let d = (px - v[0][0]) * (px - v[0][0]) + (py - v[0][1]) * (py - v[0][1]);
  let sgn = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = v[j][0] - v[i][0];
    const ey = v[j][1] - v[i][1];
    const wx = px - v[i][0];
    const wy = py - v[i][1];
    const t = cl01((wx * ex + wy * ey) / (ex * ex + ey * ey || 1));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= v[i][1];
    const c2 = py < v[j][1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sgn = -sgn;
  }
  return sgn * Math.sqrt(d);
}
/** Fill a polygon with an optional outline of `outline` px (drawn outside the shape). */
export function fillPolygon(s: Surface, pts: Array<[number, number]>, c: RGB, outline = 0, oc: RGB = [0, 0, 0], alpha = 1): void {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const m = outline + 2;
  const x0 = Math.max(0, Math.floor(minX - m));
  const x1 = Math.min(s.w - 1, Math.ceil(maxX + m));
  const y0 = Math.max(0, Math.floor(minY - m));
  const y1 = Math.min(s.h - 1, Math.ceil(maxY + m));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const sd = sdPolygon(x + 0.5, y + 0.5, pts);
      if (outline > 0) {
        const ao = cl01(0.5 - (sd - outline)) * alpha;
        if (ao > 0) s.px(x, y, oc[0], oc[1], oc[2], ao);
      }
      const a = cl01(0.5 - sd) * alpha;
      if (a > 0) s.px(x, y, c[0], c[1], c[2], a);
    }
  }
}
