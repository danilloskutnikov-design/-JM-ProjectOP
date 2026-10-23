/** Virtual time: the simulation advances in fixed ticks, never by wall-clock. */
export const FPS = 30;
export const DT = 1 / FPS;
export function ticksToSec(t: number): number { return t / FPS; }
export function secToTicks(s: number): number { return Math.round(s * FPS); }
