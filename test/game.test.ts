import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, safeRect } from '../packages/schema/index.ts';
import type { Take } from '../packages/schema/index.ts';
import { computeLayout, inRect, distToRect } from '../packages/phonecase/index.ts';
import { runTake, verifyTake, TakePlayer } from '../packages/session/index.ts';
import { buildGameConfig, computeStageKeys, newProject } from '../packages/project/index.ts';
import { ctx, STAGES } from './helpers.ts';

function record(preset: 'onboard' | 'paywall', persona: string, seed: number, over: { stallSeconds?: number; maxSeconds?: number; stageParams?: Record<string, number> } = {}) {
  const c = ctx();
  const stages = over.stageParams ? STAGES.map((s) => (s.id === 'clean' ? { ...s, params: over.stageParams } : s)) : STAGES;
  const p = newProject({ name: 't', preset, stages, scenarioSource: '' }, c.assets);
  const cfg = buildGameConfig(p, c.assets);
  const keys = computeStageKeys(p, cfg, c.registry);
  const take = runTake({ id: 't', cfg, registry: c.registry, seed, persona, speed: 1, stageKeys: keys, stallSeconds: over.stallSeconds, maxSeconds: over.maxSeconds });
  return { c, p, cfg, keys, take };
}

test('presets: safe areas match the spec and scale proportionally', () => {
  assert.deepEqual(safeRect(PRESETS.onboard), { x: 150, y: 150, w: 824, h: 824 });
  assert.deepEqual(safeRect(PRESETS.paywall), { x: 200, y: 185, w: 724, h: 630 });
  const half = safeRect(PRESETS.onboard, 562, 562);
  assert.deepEqual(half, { x: 75, y: 75, w: 412, h: 412 });
  const pw = safeRect(PRESETS.paywall, 562, 500);
  assert.deepEqual(pw, { x: 100, y: 92.5, w: 362, h: 315 });
});

test('layout: case, tray and every sticker slot lie inside the safe area (both presets)', () => {
  for (const id of ['onboard', 'paywall']) {
    const L = computeLayout(PRESETS[id]);
    const inside = (r: { x: number; y: number; w: number; h: number }) =>
      r.x >= L.safe.x && r.y >= L.safe.y && r.x + r.w <= L.safe.x + L.safe.w && r.y + r.h <= L.safe.y + L.safe.h;
    assert.ok(inside(L.caseRect), `${id}: case inside safe`);
    assert.ok(inside(L.trayRect), `${id}: tray inside safe`);
    for (const s of L.tray) assert.ok(inRect(s, L.safe), `${id}: slot inside safe`);
    // the finished case is centered horizontally in the safe area
    assert.ok(Math.abs(L.caseRect.x + L.caseRect.w / 2 - (L.safe.x + L.safe.w / 2)) <= 1, `${id}: case centered`);
  }
});

test('event contract: every stage reports start → action → change → completion, exactly one result.ready', () => {
  for (const preset of ['onboard', 'paywall'] as const) {
    for (const persona of ['careful', 'fast', 'playful']) {
      const { take } = record(preset, persona, 3);
      assert.equal(take.status, 'ok', `${preset}/${persona}: ${take.error?.message}`);
      const ev = take.events;
      for (let i = 1; i < ev.length; i++) assert.ok(ev[i].tick >= ev[i - 1].tick, 'ticks are non-decreasing');
      assert.equal(ev.filter((e) => e.type === 'result.ready').length, 1);
      assert.equal(ev.filter((e) => e.type === 'capture.failed').length, 0);
      assert.equal(ev[ev.length - 1].type, 'result.ready');
      STAGES.forEach((s, i) => {
        const of = (t: string) => ev.filter((e) => e.stageId === s.id && e.type === t);
        assert.equal(of('stage.started').length, 1, `${s.id} started once`);
        assert.equal(of('stage.completed').length, 1, `${s.id} completed once`);
        assert.ok(of('action.started').length >= 1, `${s.id} has actions`);
        assert.equal(of('action.started').length, of('action.completed').length, `${s.id}: every action is closed`);
        if (s.id !== 'reveal') assert.ok(of('visual.change').length >= 2, `${s.id} reports visible changes`);
        assert.ok(of('stage.started')[0].tick <= of('action.started')[0].tick);
        assert.ok(of('action.completed').at(-1)!.tick <= of('stage.completed')[0].tick);
        if (i > 0) assert.equal(of('stage.started')[0].tick, ev.find((e) => e.stageId === STAGES[i - 1].id && e.type === 'stage.completed')!.tick, 'next stage starts when the previous one completes');
      });
    }
  }
});

test('bot works only inside the safe area (every pressed pointer sample, both presets, all personas)', () => {
  for (const preset of ['onboard', 'paywall'] as const) {
    for (const persona of ['careful', 'fast', 'playful']) {
      const { take, p } = record(preset, persona, 5);
      const L = computeLayout(p.preset);
      take.actions.forEach(([x, y, d], i) => {
        if (d === 1) assert.ok(inRect({ x, y }, L.safe), `${preset}/${persona} tick ${i}: (${x},${y}) is outside the safe area`);
      });
    }
  }
});

test('bot moves like a hand: no teleports, persona changes speed, tremor present', () => {
  const careful: number[] = [];
  const fast: number[] = [];
  for (let seed = 1; seed <= 4; seed++) {
    const a = record('onboard', 'careful', seed).take;
    const b = record('onboard', 'fast', seed).take;
    careful.push(a.ticks);
    fast.push(b.ticks);
    let maxStep = 0;
    for (let i = 1; i < a.actions.length; i++) maxStep = Math.max(maxStep, Math.hypot(a.actions[i][0] - a.actions[i - 1][0], a.actions[i][1] - a.actions[i - 1][1]));
    assert.ok(maxStep < 120, `max step per tick ${maxStep.toFixed(1)}px`);
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  assert.ok(mean(fast) < mean(careful) * 0.85, `fast (${mean(fast)}) should be clearly quicker than careful (${mean(careful)})`);
  // while hovering at one place the pointer still wobbles (tremor), it is never frozen to a single float
  const t = record('onboard', 'careful', 1).take;
  const xs = new Set(t.actions.slice(0, 40).map((a) => a[0]));
  assert.ok(xs.size > 10);
});

test('determinism: same inputs → identical take; different seed → different play', () => {
  const a = record('onboard', 'playful', 11).take;
  const b = record('onboard', 'playful', 11).take;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = record('onboard', 'playful', 12).take;
  assert.notEqual(JSON.stringify(a.actions), JSON.stringify(c.actions));
});

test('robustness: the bot finishes the game for 12 seeds × 3 personas × 2 presets without stalling', () => {
  for (const preset of ['onboard', 'paywall'] as const) {
    for (const persona of ['careful', 'fast', 'playful']) {
      for (let seed = 1; seed <= 12; seed++) {
        const { take } = record(preset, persona, seed);
        assert.equal(take.status, 'ok', `${preset}/${persona}/seed ${seed}: ${take.error?.code} ${take.error?.message}`);
      }
    }
  }
});

test('replay: a take replays from recorded actions alone (no bot) and reproduces events + final state', () => {
  const { take, cfg, c } = record('onboard', 'careful', 2);
  const r = verifyTake(cfg, c.registry, [take], take);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  // tampering is detected
  const bad: Take = JSON.parse(JSON.stringify(take));
  bad.actions[300] = [bad.actions[300][0] + 60, bad.actions[300][1], bad.actions[300][2]];
  assert.equal(verifyTake(cfg, c.registry, [bad], bad).ok, false);
  // a JSON round-trip (save → open) changes nothing
  const rt: Take = JSON.parse(JSON.stringify(take));
  assert.equal(verifyTake(cfg, c.registry, [rt], rt).ok, true);
});

test('watchdog: a stuck stage ends the take with a diagnosable error instead of hanging', () => {
  const t = record('onboard', 'careful', 1, { stallSeconds: 3, stageParams: { cleanThreshold: 1.5 } }).take;
  assert.equal(t.status, 'failed');
  assert.equal(t.error?.code, 'STAGE_STALLED');
  assert.equal(t.error?.stage, 'clean');
  assert.ok(t.events.some((e) => e.type === 'capture.failed'));
  assert.ok(t.ticks < 30 * 60, 'bounded run time');
  const to = record('onboard', 'careful', 1, { maxSeconds: 2 }).take;
  assert.equal(to.error?.code, 'TIMEOUT');
});

test('replay of a failed take still matches (the failure is reproducible)', () => {
  const { take, cfg, c } = record('onboard', 'careful', 1, { stallSeconds: 3, stageParams: { cleanThreshold: 1.5 } });
  assert.equal(verifyTake(cfg, c.registry, [take], take).ok, true);
});

test('the result frame is shown without the tool over the case', () => {
  const { take, cfg, c } = record('paywall', 'careful', 4);
  const g = new TakePlayer(cfg, c.registry, [take], take).advanceTo(take.ticks);
  assert.equal(g.finished, true);
  assert.ok(!g.pointer.down && distToRect(g.pointer, g.layout.caseRect) >= 50);
  assert.ok(g.stickers.every((s) => s.state === 'fixed'));
});
