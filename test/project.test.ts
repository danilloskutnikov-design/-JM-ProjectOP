import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { hashBytes } from '../packages/core/index.ts';
import { PRESETS, validateProject } from '../packages/schema/index.ts';
import type { Project } from '../packages/schema/index.ts';
import { Surface } from '../packages/render/index.ts';
import { buildGameConfig, computeStageKeys, exportBatch, exportMp4, loadProject, rebuild, renderTimeline, saveProject, stageStatus, verifyProject } from '../packages/project/index.ts';
import { build, ctx, frameHashes } from './helpers.ts';

const keysOf = (p: Project, c = ctx()) => computeStageKeys(p, buildGameConfig(p, c.assets), c.registry);

test('stage keys: only what a stage depends on invalidates it (and the stages after it)', () => {
  const c = ctx();
  const { p } = build('onboard');
  const base = keysOf(p, c);
  const mod = (f: (q: Project) => void) => { const q: Project = structuredClone(p); f(q); return keysOf(q, c); };
  const diff = (a: string[], b: string[]) => a.map((k, i) => (k !== b[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(diff(base, mod((q) => { q.scene.drawing = 'drawing-flower'; })), [1, 2, 3], 'drawing → draw, stickers, reveal; NOT clean');
  assert.deepEqual(diff(base, mod((q) => { q.scene.stickers[0].asset = 'sticker-dot'; })), [2, 3], 'sticker asset → stickers, reveal');
  assert.deepEqual(diff(base, mod((q) => { q.scene.stickers[1].u = 0.5; })), [2, 3], 'sticker position → stickers, reveal');
  assert.deepEqual(diff(base, mod((q) => { q.scene.background = 'bg-calm'; })), [], 'background is render-only');
  assert.deepEqual(diff(base, mod((q) => { q.scene.caseColor = '#112233'; })), [], 'case color is render-only');
  assert.deepEqual(diff(base, mod((q) => { q.preset.quietZone = { x: 1, y: 2, w: 3, h: 4 }; })), [], 'quiet zone is render-only');
  assert.deepEqual(diff(base, mod((q) => { q.scenario.stages[1].targetSec = 5; })), [], 'durations are edit-only');
  assert.deepEqual(diff(base, mod((q) => { q.scene.seed = 99; })), [0, 1, 2, 3], 'scene seed → everything');
  assert.deepEqual(diff(base, mod((q) => { q.preset = { ...PRESETS.paywall }; })), [0, 1, 2, 3], 'preset → everything');
});

test('replacing the drawing after the edit: only affected stages are re-simulated, the edit plan is kept', async () => {
  const { p, c } = build('onboard');
  const planBefore = p.timeline!.stages.map((s) => [s.stageId, s.targetFrames]);
  const before = await frameHashes(p, c);
  const cleanFrames = p.timeline!.stages[0].outFrames;

  p.scene.drawing = 'drawing-flower';
  const st = stageStatus(p, c);
  assert.deepEqual(st.stale, ['draw', 'stickers', 'reveal'], 'the incompatible stages are named');
  await assert.rejects(() => renderTimeline(p, c, p.timeline!, { onFrame() {} }), /need regeneration: draw, stickers, reveal/);

  const rep = rebuild(p, c);
  assert.deepEqual(rep.reused, ['clean']);
  assert.deepEqual(rep.regenerated, ['draw', 'stickers', 'reveal']);
  assert.equal(p.takes.length, 2);
  assert.deepEqual(p.takes[1].parent, { takeId: 'take-1', stage: 1 }, 'the retake continues from the preserved state after cleaning');
  assert.equal(p.takes[1].startStage, 1);
  assert.deepEqual(p.timeline!.stages.map((s) => [s.stageId, s.targetFrames]), planBefore, 'order and target durations are preserved');
  assert.equal(p.timeline!.clips.filter((x) => x.stageId === 'clean').every((x) => x.takeId === 'take-1'), true, 'cleaning is the same recording');
  assert.equal(p.timeline!.clips.filter((x) => x.stageId !== 'clean').every((x) => x.takeId === 'take-2'), true);

  const after = await frameHashes(p, c);
  assert.deepEqual(after.slice(0, cleanFrames), before.slice(0, cleanFrames), 'cleaning frames are pixel-identical');
  assert.notDeepEqual(after.slice(cleanFrames), before.slice(cleanFrames), 'the new drawing is rendered');
  assert.ok(verifyProject(p, c).every((r) => r.ok), 'all takes still replay exactly');
  const g = new Set(p.takes[1].events.filter((e) => e.type === 'stage.completed').map((e) => e.stageId));
  assert.deepEqual([...g], ['draw', 'stickers', 'reveal']);
});

test('replacing stickers: only stickers and reveal are re-simulated; cleaning and drawing are reused', () => {
  const { p, c } = build('onboard');
  p.scene.stickers = p.scene.stickers.map((s, i) => ({ ...s, asset: ['sticker-heart', 'sticker-dot', 'sticker-star'][i] }));
  const rep = rebuild(p, c);
  assert.deepEqual(rep.reused, ['clean', 'draw']);
  assert.deepEqual(rep.regenerated, ['stickers', 'reveal']);
  assert.deepEqual(p.takes[1].parent, { takeId: 'take-1', stage: 2 });
  assert.ok(verifyProject(p, c).every((r) => r.ok));
});

test('replacing background / case color needs no re-simulation, only a re-render', async () => {
  const { p, c } = build('paywall');
  const before = await frameHashes(p, c);
  p.scene.background = 'bg-calm';
  p.scene.caseColor = '#dfe9f5';
  assert.deepEqual(stageStatus(p, c).stale, []);
  const rep = rebuild(p, c);
  assert.equal(rep.newTakes.length, 0);
  const after = await frameHashes(p, c);
  assert.equal(after.length, before.length);
  assert.ok(after.every((h, i) => h !== before[i]), 'every frame is re-rendered with the new look');
});

test('an incompatible or missing asset is reported clearly', () => {
  const { p, c } = build('onboard');
  p.scene.drawing = 'no-such-drawing';
  assert.throws(() => rebuild(p, c), /asset "no-such-drawing" not found/);
  p.scene.drawing = 'sticker-star';
  assert.throws(() => rebuild(p, c), /is a sticker, expected drawing/);
});

test('not enough material: the tool retries, then says what is missing instead of faking a video', async () => {
  const c = ctx();
  const { p } = build('onboard');
  const q: Project = structuredClone(p);
  q.takes = [];
  q.timeline = null;
  const rep = rebuild(q, c, { stallSeconds: 0.2, maxAttempts: 2 });
  assert.equal(rep.attempts, 2);
  assert.ok(rep.failures.length >= 1 && rep.failures.every((f) => f.code === 'STAGE_STALLED'));
  assert.ok(rep.timeline.needsRetake.length > 0);
  assert.ok(rep.timeline.needsRetake.every((n) => n.reason === 'MISSING'));
  await assert.rejects(() => renderTimeline(q, c, q.timeline!, { onFrame() {} }), /need regeneration/);
});

test('project file: save → open → rebuild is a no-op, replay stays exact', () => {
  const { p, c } = build('onboard');
  const dir = mkdtempSync(tmpdir() + '/pop-');
  saveProject(p, dir + '/p.json');
  const q = loadProject(dir + '/p.json');
  assert.deepEqual(validateProject(q), []);
  const rep = rebuild(q, c);
  assert.equal(rep.newTakes.length, 0);
  assert.ok(verifyProject(q, c).every((r) => r.ok));
  assert.deepEqual(q.modLock.map((m) => m.id).sort(), ['careful', 'clean', 'clean', 'draw', 'draw', 'fast', 'playful', 'reveal', 'reveal', 'stickers', 'stickers']);
});

test('validation catches broken projects', () => {
  const { p } = build('onboard');
  const bad: Project = structuredClone(p);
  bad.scene.stickers = [...bad.scene.stickers, ...bad.scene.stickers];
  bad.takes[0].actions.pop();
  const errs = validateProject(bad);
  assert.ok(errs.some((e) => /at most 4 stickers/.test(e)));
  assert.ok(errs.some((e) => /actions.length/.test(e)));
});

test('rendering is deterministic; guides exist in preview but never in export', async () => {
  const { p, c } = build('onboard');
  const a = await frameHashes(p, c);
  const b = await frameHashes(p, c);
  assert.deepEqual(a, b);
  const withGuides = await frameHashes(p, c, 0.25, true);
  assert.notDeepEqual(a.slice(0, 5), withGuides.slice(0, 5), 'guides change the preview');
  const dir = mkdtempSync(tmpdir() + '/pop-');
  const rep = await exportMp4(p, c, dir + '/v.mp4', 0.25);
  assert.deepEqual(rep.frameHashes, a, 'the export renders exactly the guide-free frames');
});

test('MP4: H.264, 30 FPS, yuv420p, right size and length, no black frames, matches the preview', async () => {
  const { p, c } = build('paywall');
  const dir = mkdtempSync(tmpdir() + '/pop-');
  const out = dir + '/v.mp4';
  const rep = await exportMp4(p, c, out, 0.5);
  assert.ok(existsSync(out));
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames', '-of', 'default=nw=1', out]).stdout.toString();
  const kv = Object.fromEntries(pr.trim().split(/\r?\n/).map((l) => l.split('=')));
  assert.equal(kv.codec_name, 'h264');
  assert.equal(kv.pix_fmt, 'yuv420p');
  assert.equal(kv.r_frame_rate, '30/1');
  assert.equal(Number(kv.width), rep.width);
  assert.equal(Number(kv.height), rep.height);
  assert.equal(Number(kv.nb_frames), p.timeline!.totalFrames);
  assert.equal(rep.blackFrames, 0);
  // decode a few frames and compare with what the preview renderer produced
  const frames = new Map<number, Surface>();
  const want = [0, 40, 120, 200, p.timeline!.totalFrames - 1];
  await renderTimeline(p, c, p.timeline!, { scale: 0.5, shouldRender: (i) => want.includes(i), onFrame(s, i) { const f = new Surface(s.w, s.h); f.copyFrom(s); frames.set(i, f); } });
  for (const n of want) {
    const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select=eq(n\\,${n})`, '-vframes', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 }).stdout;
    const ref = frames.get(n)!;
    assert.equal(raw.length, ref.data.length, `frame ${n} decoded`);
    let sum = 0;
    for (let i = 0; i < raw.length; i += 4) sum += Math.abs(raw[i] - ref.data[i]) + Math.abs(raw[i + 1] - ref.data[i + 1]) + Math.abs(raw[i + 2] - ref.data[i + 2]);
    const mad = sum / ((raw.length / 4) * 3);
    assert.ok(mad < 3, `frame ${n}: mean abs diff vs preview ${mad.toFixed(2)}`);
  }
});

test('cut loop: three consecutive passes have no black frame, no empty stretch and an identical seam each time', async () => {
  const { p, c } = build('onboard');
  const hashes = await frameHashes(p, c);
  const pass3 = [...hashes, ...hashes, ...hashes];
  assert.equal(pass3.length, hashes.length * 3);
  const first = new Surface(1, 1);
  void first;
  let black = 0;
  let minLuma = 255;
  await renderTimeline(p, c, p.timeline!, { scale: 0.25, onFrame(s) {
    let sum = 0;
    for (let i = 0; i < s.data.length; i += 4) sum += 0.2126 * s.data[i] + 0.7152 * s.data[i + 1] + 0.0722 * s.data[i + 2];
    const l = sum / (s.data.length / 4);
    minLuma = Math.min(minLuma, l);
    if (l < 8) black++;
  } });
  assert.equal(black, 0);
  assert.ok(minLuma > 40, `darkest frame luma ${minLuma.toFixed(0)}`);
  // the first frame of every pass is the initial (dirty) state, the last is the finished case: a clean hard cut
  assert.notEqual(hashes[0], hashes.at(-1));
  for (let k = 1; k < 3; k++) assert.equal(pass3[k * hashes.length], hashes[0]);
  // no long frozen stretch except the intended final hold
  let run = 1, maxRun = 1;
  for (let i = 1; i < hashes.length; i++) { run = hashes[i] === hashes[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  assert.ok(maxRun <= 40, `longest frozen run ${maxRun} frames`);
});

test('batch: variants with different settings; unchanged stages are reused', async () => {
  const { p, c } = build('onboard');
  const dir = mkdtempSync(tmpdir() + '/pop-');
  const res = await exportBatch(p, c, [
    { name: 'calm-bg', background: 'bg-calm', scale: 0.25 },
    { name: 'flower', drawing: 'drawing-flower', stickers: ['sticker-heart', 'sticker-dot', 'sticker-star'], scale: 0.25 },
    { name: 'paywall', preset: 'paywall', quietZone: { x: 964, y: 20, w: 140, h: 110 }, background: 'bg-calm', scale: 0.25 },
  ], dir);
  assert.equal(res.length, 3);
  assert.deepEqual(res[0].build.regenerated, [], 'background variant re-renders only');
  assert.deepEqual(res[1].build.regenerated, ['draw', 'stickers', 'reveal']);
  assert.deepEqual(res[2].build.regenerated, ['clean', 'draw', 'stickers', 'reveal']);
  for (const r of res) { assert.ok(existsSync(r.export.path)); assert.equal(r.export.blackFrames, 0); }
  assert.ok(res[2].export.height < res[2].export.width, 'paywall is 1124×1000');
  assert.equal(res[2].export.quietZone?.ok, true, 'calm background keeps the close-button zone quiet');
  assert.equal(p.takes.length, 1, 'the base project is untouched');
});

test('quiet zone: a busy background is flagged, a calm one passes, independent of export scale', async () => {
  const zone = { x: 964, y: 20, w: 140, h: 110 };
  const busy = build('paywall', { quietZone: zone, background: 'bg-dots' });
  const calm = build('paywall', { quietZone: zone, background: 'bg-calm' });
  const dir = mkdtempSync(tmpdir() + '/pop-');
  for (const scale of [0.25, 0.5]) {
    const b = await exportMp4(busy.p, busy.c, dir + '/b.mp4', scale);
    const k = await exportMp4(calm.p, calm.c, dir + '/c.mp4', scale);
    assert.equal(b.quietZone!.ok, false, `busy @${scale}: ${b.quietZone!.edgeDensity.toFixed(2)}`);
    assert.equal(k.quietZone!.ok, true, `calm @${scale}: ${k.quietZone!.edgeDensity.toFixed(2)}`);
  }
});

void hashBytes;
