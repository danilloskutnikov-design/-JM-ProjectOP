// Generates PLACEHOLDER assets (not Phone Case art). Real assets live outside the repo (see .gitignore).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sin, cos, PI } from '../packages/core/index.ts';

const dir = fileURLToPath(new URL('../examples/assets/', import.meta.url));
mkdirSync(dir, { recursive: true });
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const save = (name: string, obj: unknown) => writeFileSync(dir + name + '.json', JSON.stringify(obj, null, 1) + '\n');

// case is 1:2 (w:h) → a square in px has v-extent = u-extent * 0.5
const AR = 0.5;

function heart(cu: number, cv: number, size: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * PI;
    const x = 16 * sin(t) * sin(t) * sin(t);
    const y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t);
    pts.push([r4(cu + (x / 16) * size), r4(cv - (y / 16) * size * AR)]);
  }
  return pts;
}
function star(cu: number, cv: number, R: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const a = -PI / 2 + (i * PI) / 5;
    const rr = i % 2 === 0 ? R : R * 0.42;
    pts.push([r4(cu + rr * cos(a)), r4(cv + rr * sin(a) * AR)]);
  }
  return pts;
}
function wave(u0: number, u1: number, v: number, amp: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([r4(u0 + (u1 - u0) * t), r4(v + amp * sin(t * 4 * PI))]);
  }
  return pts;
}
function circle(cu: number, cv: number, R: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * 2 * PI;
    pts.push([r4(cu + R * cos(a)), r4(cv + R * sin(a) * AR)]);
  }
  return pts;
}

save('drawing-heart-star', {
  id: 'drawing-heart-star', kind: 'drawing', name: 'Heart + star + wave (placeholder)',
  data: { strokes: [
    { color: '#ff4d6d', width: 12, points: heart(0.5, 0.36, 0.27) },
    { color: '#ffb703', width: 12, points: star(0.5, 0.68, 0.24) },
    { color: '#3a86ff', width: 10, points: wave(0.32, 0.68, 0.87, 0.012) },
  ] },
});

const petals: Array<{ color: string; width: number; points: Array<[number, number]> }> = [
  { color: '#ffd166', width: 12, points: circle(0.5, 0.42, 0.07) },
];
for (let i = 0; i < 5; i++) {
  const a = -PI / 2 + (i * 2 * PI) / 5;
  petals.push({ color: '#c77dff', width: 11, points: circle(r4(0.5 + 0.17 * cos(a)), r4(0.42 + 0.17 * sin(a) * AR), 0.1) });
}
petals.push({ color: '#06d6a0', width: 10, points: wave(0.32, 0.68, 0.84, 0.015) });
save('drawing-flower', { id: 'drawing-flower', kind: 'drawing', name: 'Flower + wave (placeholder)', data: { strokes: petals } });

const sticker = (id: string, shape: string, color: string, name: string) =>
  save(id, { id, kind: 'sticker', name, data: { shape, color, size: 1 } });
sticker('sticker-star', 'star', '#ffd166', 'Star (placeholder)');
sticker('sticker-heart', 'heart', '#ef476f', 'Heart (placeholder)');
sticker('sticker-bolt', 'bolt', '#06d6a0', 'Bolt (placeholder)');
sticker('sticker-smile', 'smile', '#ffd23f', 'Smile (placeholder)');
sticker('sticker-dot', 'circle', '#118ab2', 'Dot (placeholder)');

save('bg-dots', { id: 'bg-dots', kind: 'background', name: 'Busy dots background', data: { top: '#4361ee', bottom: '#7209b7', dots: '#ffffff' } });
save('bg-calm', { id: 'bg-calm', kind: 'background', name: 'Calm gradient background', data: { top: '#3a0ca3', bottom: '#4361ee', dots: null } });
console.log('assets generated in', dir);
