export interface Rect { x: number; y: number; w: number; h: number }
export interface Insets { l: number; r: number; t: number; b: number }
export interface Preset {
  id: string;
  width: number;
  height: number;
  /** Insets of the "main action area" inside the full frame (px at native size). */
  insets: Insets;
  /** User-defined area that must stay visually quiet (e.g. paywall close button), native px. */
  quietZone: Rect | null;
}

export const PRESETS: Record<string, Preset> = {
  onboard: { id: 'onboard', width: 1124, height: 1124, insets: { l: 150, r: 150, t: 150, b: 150 }, quietZone: null },
  paywall: { id: 'paywall', width: 1124, height: 1000, insets: { l: 200, r: 200, t: 185, b: 185 }, quietZone: null },
};

/** Safe rectangle for an output size; insets scale proportionally to each frame dimension. */
export function safeRect(p: Preset, outW: number = p.width, outH: number = p.height): Rect {
  const kx = outW / p.width;
  const ky = outH / p.height;
  return {
    x: p.insets.l * kx,
    y: p.insets.t * ky,
    w: outW - (p.insets.l + p.insets.r) * kx,
    h: outH - (p.insets.t + p.insets.b) * ky,
  };
}

export function scaleRect(r: Rect, outW: number, outH: number, p: Preset): Rect {
  const kx = outW / p.width;
  const ky = outH / p.height;
  return { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky };
}
