import { hashString32 } from './hash.ts';

/** Seeded PRNG (mulberry32). All randomness in simulation/bots must come from here. */
export class Rng {
  seed0: number;
  s: number;
  constructor(seed: number) {
    this.seed0 = seed >>> 0;
    this.s = this.seed0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  /** ~N(0,1) via Irwin–Hall (sum of 12 uniforms) — arithmetic only. */
  normal(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Independent child stream: depends only on the base seed and the label. */
  fork(label: string): Rng { return new Rng(hashString32(this.seed0 + ':' + label)); }
}
