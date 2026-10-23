import { safeRect } from '../schema/index.ts';
import type { Preset, Rect } from '../schema/index.ts';

export interface Pt { x: number; y: number }

export interface Layout {
  frame: { w: number; h: number };
  safe: Rect;
  caseRect: Rect;
  caseRadius: number;
  /** Slot centers of the sticker tray. */
  tray: Pt[];
  slotSize: number;
  trayRect: Rect;
  /** Brush/sponge radius. */
  toolR: number;
  /** Dirt grid cell size (px). */
  cell: number;
  /** Where the tool leaves the frame. */
  exitPoint: Pt;
}

/**
 * Everything the player must see (case, tray, tool during work) is placed inside
 * the safe rectangle. Layout is derived from the preset's safe area, so both
 * Onboard (824×824) and Paywall (724×630) work without hand-tuned coordinates.
 */
export function computeLayout(p: Preset): Layout {
  const safe = safeRect(p);
  const caseH = Math.round(safe.h * 0.9);
  const caseW = Math.round(caseH * 0.5);
  const trayW = Math.round(safe.w * 0.13);
  const gap = 60;
  // The finished case is centered in the safe area (the tray disappears at the reveal);
  // the tray sits to its right, still inside the safe area.
  const x0 = Math.round(safe.x + (safe.w - caseW) / 2);
  const caseRect: Rect = { x: x0, y: Math.round(safe.y + (safe.h - caseH) / 2), w: caseW, h: caseH };
  const slotSize = Math.round(trayW * 0.8);
  const trayRect: Rect = { x: x0 + caseW + gap, y: caseRect.y, w: trayW, h: caseH };
  const tray: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    tray.push({ x: Math.round(trayRect.x + trayW / 2), y: Math.round(caseRect.y + (caseH * (i + 1)) / 5) });
  }
  return {
    frame: { w: p.width, h: p.height },
    safe,
    caseRect,
    caseRadius: Math.round(caseW * 0.14),
    tray,
    slotSize,
    trayRect,
    toolR: Math.round(caseW * 0.075),
    cell: 4,
    exitPoint: { x: p.width + 90, y: Math.round(p.height * 0.62) },
  };
}

export function inRect(p: Pt, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
export function distToRect(p: Pt, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.sqrt(dx * dx + dy * dy);
}
/** Signed distance to a rounded box (negative inside). */
export function sdRoundBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
