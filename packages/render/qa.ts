import type { Surface } from './surface.ts';
import type { Rect } from '../schema/index.ts';

export interface QuietZoneReport { edgeDensity: number; lumaStd: number; ok: boolean; threshold: number }

/**
 * "Does this area attract the eye?" proxy: mean luma gradient magnitude + luma spread inside the
 * user-defined quiet zone. Only analyses the zone the user placed; it never guesses the close button position.
 */
export function quietZoneReport(s: Surface, zone: Rect, scale: number, threshold = 0.2): QuietZoneReport {
  const x0 = Math.max(1, Math.floor(zone.x * scale));
  const y0 = Math.max(1, Math.floor(zone.y * scale));
  const x1 = Math.min(s.w - 1, Math.ceil((zone.x + zone.w) * scale));
  const y1 = Math.min(s.h - 1, Math.ceil((zone.y + zone.h) * scale));
  const luma = (x: number, y: number) => { const i = (y * s.w + x) * 4; return 0.2126 * s.data[i] + 0.7152 * s.data[i + 1] + 0.0722 * s.data[i + 2]; };
  let grad = 0, n = 0, sum = 0, sum2 = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const l = luma(x, y);
      grad += Math.abs(luma(x + 1, y) - l) + Math.abs(luma(x, y + 1) - l);
      sum += l; sum2 += l * l; n++;
    }
  }
  if (n === 0) return { edgeDensity: 0, lumaStd: 0, ok: true, threshold };
  const mean = sum / n;
  // Edge length per pixel of area grows as 1/scale, so multiply by scale to get a resolution-independent number.
  const edgeDensity = (grad / n) * scale;
  return { edgeDensity, lumaStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), ok: edgeDensity <= threshold, threshold };
}

export function meanLuma(s: Surface): number {
  let sum = 0;
  for (let i = 0; i < s.data.length; i += 4) sum += 0.2126 * s.data[i] + 0.7152 * s.data[i + 1] + 0.0722 * s.data[i + 2];
  return sum / (s.data.length / 4);
}

/** Mean absolute per-channel difference between two frames (0..255). Used for loop seams. */
export function frameDiff(a: Surface, b: Surface): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return sum / ((a.data.length / 4) * 3);
}
