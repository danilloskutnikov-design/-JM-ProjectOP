// Deterministic math helpers.
// The simulation path uses only IEEE-754 exact operations (+ - * / sqrt, floor).
// libm functions (sin/cos/log/pow) are avoided because their last-bit results
// may differ between engines; we provide arithmetic-only versions instead.

export const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const LN2 = 0.6931471805599453;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Minimum-jerk position profile: bell-shaped velocity, zero speed/accel at ends. */
export function minJerk(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * u * (10 - 15 * u + 6 * u * u);
}
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
export function round(v: number, digits = 4): number {
  const m = digits === 2 ? 100 : digits === 3 ? 1000 : 10000;
  return Math.round(v * m) / m;
}
/** log2 via range reduction + atanh series (arithmetic only). */
export function log2(x: number): number {
  if (!(x > 0)) return -Infinity;
  let e = 0;
  while (x >= 2) { x /= 2; e++; }
  while (x < 1) { x *= 2; e--; }
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let s = 0;
  let p = z;
  for (let k = 0; k < 9; k++) { s += p / (2 * k + 1); p *= z2; }
  return e + (2 * s) / LN2;
}
/** sin via range reduction + Taylor series (arithmetic only). */
export function sin(x: number): number {
  x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 10; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}
export function cos(x: number): number {
  return sin(x + PI / 2);
}
