import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from '../packages/editor/index.ts';
import { TakePlayer, producer } from '../packages/session/index.ts';
import { buildGameConfig } from '../packages/project/index.ts';
import { distToRect } from '../packages/phonecase/index.ts';
import { build } from './helpers.ts';

const SUPPORTED = ['clean', 'draw', 'stickers', 'reveal'];

test('plan: the instruction from the spec is parsed into 4 ordered stages', () => {
  const p = parsePlan('Сначала очистка чехла, затем рисование, затем наклейки и показ результата', SUPPORTED);
  assert.equal(p.ok, true);
  assert.deepEqual(p.stages.map((s) => s.type), ['clean', 'draw', 'stickers', 'reveal']);
});

test('plan: durations are read; unsupported / unknown / ambiguous / misordered requests are flagged, never substituted', () => {
  assert.equal(parsePlan('очистка 4 сек, рисование 2.5 секунды, наклейки, финал', SUPPORTED).stages.map((s) => s.targetSec).join(','), '4,2.5,3,2');
  const unknown = parsePlan('очистка, взрыв, показ результата', SUPPORTED);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.issues.some((i) => i.chunk === 'взрыв'));
  assert.equal(parsePlan('показ результата, затем очистка', SUPPORTED).ok, false);
  assert.equal(parsePlan('очистка, очистка', SUPPORTED).ok, false);
  assert.equal(parsePlan('рисование наклеек', SUPPORTED).ok, false, 'two stages in one phrase must not collapse into one');
  assert.equal(parsePlan('', SUPPORTED).ok, false);
  assert.equal(parsePlan('очистка, наклейки', ['clean']).ok, false, 'a stage type that is not registered is reported');
});

test('edit: auto-montage yields clean → draw → stickers → result within the target durations', () => {
  for (const preset of ['onboard', 'paywall'] as const) {
    const { p, report } = build(preset);
    const tl = p.timeline!;
    assert.deepEqual(tl.stages.map((s) => s.stageId), ['clean', 'draw', 'stickers', 'reveal']);
    assert.equal(tl.needsRetake.length, 0);
    assert.equal(tl.totalFrames, tl.clips.reduce((s, c) => s + c.outFrames, 0));
    for (const s of tl.stages) {
      const ok = Math.abs(s.outFrames - s.targetFrames) <= s.targetFrames * 0.35 || s.note !== '';
      assert.ok(ok, `${preset}/${s.stageId}: ${s.outFrames} vs target ${s.targetFrames} (${s.note})`);
    }
    assert.equal(tl.stages[3].actionSpeed, 1, 'the result is never sped up');
    assert.ok(report.failures.length === 0);
  }
});

test('edit: waiting and travel without a useful action are compressed; the raw take is much longer than the cut', () => {
  const { p } = build('onboard');
  const tl = p.timeline!;
  const raw = p.takes[0].ticks;
  assert.ok(tl.totalFrames < raw * 0.6, `cut ${tl.totalFrames} vs raw ${raw}`);
  const travel = tl.clips.filter((c) => c.role === 'travel');
  assert.ok(travel.length > 0);
  for (const c of travel) assert.ok(c.outFrames <= Math.max(12, c.outTick - c.inTick), 'travel never gets longer');
  const longTravel = travel.filter((c) => c.outTick - c.inTick > 30);
  assert.ok(longTravel.length > 0 && longTravel.every((c) => c.outFrames <= 12), 'long idle/travel stretches are squeezed to ≤12 frames');
});

test('edit: every stage keeps a clear beginning, action and result', () => {
  const { p } = build('onboard');
  const clips = p.timeline!.clips;
  const first = clips[0];
  assert.equal(first.role, 'setup', 'the video starts on the untouched initial state');
  for (const id of ['clean', 'draw', 'stickers', 'reveal']) {
    const roles = new Set(clips.filter((c) => c.stageId === id).map((c) => c.role));
    assert.ok(roles.has('action'), `${id}: has action`);
    assert.ok(roles.has('payoff') || id !== 'reveal', `${id}: result`);
  }
  assert.equal(clips.at(-1)!.role, 'payoff');
  // ticks never run backwards inside one take
  const last = new Map<string, number>();
  for (const c of clips) {
    assert.ok(c.inTick >= (last.get(c.takeId) ?? 0), 'clips of a take are in order');
    last.set(c.takeId, c.outTick);
  }
});

test('selection rules: cleaning shows dirt coming off, drawing shows the drawing appear, stickers keep placement AND fixing', () => {
  const { p } = build('onboard');
  const take = p.takes[0];
  const clips = p.timeline!.clips;
  const inActionClip = (stage: string, tick: number) => clips.some((c) => c.stageId === stage && c.role === 'action' && tick >= c.inTick && tick <= c.outTick);
  const visible = (stage: string) => take.events.filter((e) => e.stageId === stage && e.type === 'visual.change' && inActionClip(stage, e.tick));
  assert.ok(visible('clean').length >= 3, 'clean: several visible dirt-removal moments are kept');
  assert.ok(visible('draw').length >= 3, 'draw: the drawing is seen appearing, not only its final look');
  const placed = take.events.filter((e) => e.stageId === 'stickers' && e.type === 'action.completed' && e.data.placed === true);
  const fixed = take.events.filter((e) => e.stageId === 'stickers' && e.type === 'action.completed' && e.data.fixed === true);
  assert.equal(placed.length, 3);
  assert.equal(fixed.length, 3);
  for (const e of [...placed, ...fixed]) assert.ok(inActionClip('stickers', e.tick), `sticker ${String(e.data.sticker)} ${e.data.placed ? 'placement' : 'fixing'} must be in the cut`);
});

test('selection rules: the final frame is the finished case, nothing covering it', () => {
  const { p, c } = build('paywall');
  const tl = p.timeline!;
  const lastClip = tl.clips.at(-1)!;
  const take = p.takes.find((t) => t.id === lastClip.takeId)!;
  const g = new TakePlayer(buildGameConfig(p, c.assets), c.registry, p.takes, take).advanceTo(lastClip.outTick);
  assert.equal(g.finished, true);
  assert.ok(!g.pointer.down && distToRect(g.pointer, g.layout.caseRect) >= 50, 'no tool over the case');
  assert.ok(g.stickers.every((s) => s.state === 'fixed'));
  assert.ok(g.strokes.length >= 3);
  assert.ok(g.dirtSum / g.dirtSum0 < 0.07);
  assert.ok(producer(take, 3, p.takes) === take);
});
