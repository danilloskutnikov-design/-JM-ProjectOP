import type { Clip, ClipRole, GameEvent, Project, Segment, StageDef, StageSummary, Take, Timeline } from '../schema/index.ts';
import { bestLineage, producer } from '../session/index.ts';

export interface EditOptions {
  /** Ticks of the untouched start of the first stage (viewer sees the initial state). */
  setupTicks: number;
  /** Ticks of approach kept at normal speed right before an action. */
  leadTicks: number;
  /** Ticks of the finished result kept at normal speed after the last action. */
  payoffTicks: number;
  /** Extra hold on the final frame after the result is ready. */
  finalHoldTicks: number;
  maxActionSpeed: number;
  /** Actions closer than this (ticks) are one continuous span. */
  mergeGap: number;
}
export const DEFAULT_EDIT: EditOptions = { setupTicks: 9, leadTicks: 6, payoffTicks: 24, finalHoldTicks: 36, maxActionSpeed: 4, mergeGap: 8 };

interface Span { a: number; b: number; intensity: number; essential: boolean }

/** Useful-action spans of one stage, from explicit game events (never from video heuristics). */
export function spansOf(events: GameEvent[], seg: Segment): Span[] {
  const evs = events.filter((e) => e.stageId === seg.stageId && e.tick >= seg.startTick && e.tick <= seg.endTick);
  const raw: Span[] = [];
  let open: number | null = null;
  let ess = false;
  for (const e of evs) {
    if (e.type === 'action.started') { open = e.tick; ess = false; }
    else if (e.type === 'action.completed' && open !== null) {
      if (e.data.fixed === true || e.data.placed === true) ess = true;
      raw.push({ a: open, b: e.tick, intensity: 0, essential: ess });
      open = null;
    }
  }
  if (open !== null) raw.push({ a: open, b: seg.endTick, intensity: 0, essential: false });
  for (const e of evs) {
    if (e.type !== 'visual.change') continue;
    const sp = raw.find((s) => e.tick >= s.a && e.tick <= s.b);
    if (sp) sp.intensity += (e.data.intensity as number) ?? 0;
  }
  return raw;
}

function mergeSpans(spans: Span[], gap: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const l = out[out.length - 1];
    if (l && s.a - l.b <= gap) { l.b = s.b; l.intensity += s.intensity; l.essential = l.essential || s.essential; }
    else out.push({ ...s });
  }
  return out;
}

const compressedFrames = (len: number) => Math.max(3, Math.min(12, Math.round(len / 6)));

interface Built { clips: Clip[]; outFrames: number; speed: number; dropped: number; note: string }

function layout(take: Take, seg: Segment, def: StageDef, spans: Span[], first: boolean, final: boolean, o: EditOptions, speed: number): Clip[] {
  const clips: Clip[] = [];
  const mk = (role: ClipRole, a: number, b: number, frames: number, reason: string) => {
    if (b < a || frames <= 0) return;
    clips.push({ takeId: take.id, stageId: def.id, role, inTick: a, outTick: b, outFrames: frames, reason });
  };
  const gap = (a: number, b: number, isFirst: boolean) => {
    let from = a;
    if (isFirst && first) { const s = Math.min(o.setupTicks, b - a); mk('setup', from, from + s, s, 'начало: исходное состояние'); from += s; }
    const lead = Math.min(o.leadTicks, b - from);
    const mid = b - lead - from;
    if (mid > 0) mk('travel', from, from + mid, compressedFrames(mid), `подход/ожидание сокращено ×${(mid / compressedFrames(mid)).toFixed(1)}`);
    mk('travel', b - lead, b, lead, 'подход к действию');
  };
  let cursor = seg.startTick;
  spans.forEach((sp, i) => {
    gap(cursor, sp.a, i === 0);
    mk('action', sp.a, sp.b, Math.max(1, Math.round((sp.b - sp.a) / speed)), speed > 1.05 ? `действие ×${speed.toFixed(1)}` : 'действие');
    cursor = sp.b;
  });
  const tailEnd = seg.endTick;
  const tail = tailEnd - cursor;
  if (tail > 0) {
    const keep = Math.min(o.payoffTicks, tail);
    mk('payoff', cursor, cursor + keep, keep, 'результат этапа');
    const rest = tail - keep;
    if (rest > 0) mk('travel', cursor + keep, tailEnd, compressedFrames(rest), 'ожидание сокращено');
  }
  if (final) {
    const takeEnd = take.startTick + take.actions.length;
    const hold = Math.min(o.finalHoldTicks, takeEnd - tailEnd);
    mk('payoff', tailEnd, tailEnd + hold, hold, 'финальный кадр: готовый чехол');
  }
  return clips;
}

export function selectStage(take: Take, seg: Segment, def: StageDef, first: boolean, final: boolean, o0: EditOptions): Built {
  let o = o0;
  let spans = mergeSpans(spansOf(take.events, seg), o.mergeGap);
  if (spans.length === 0) spans = [{ a: seg.startTick, b: seg.endTick, intensity: 0, essential: true }];
  const target = Math.round(def.targetSec * 30);
  // The result is never sped up: a reveal plays at 1× and its closing hold absorbs the time budget.
  const isReveal = def.type === 'reveal';
  if (isReveal) {
    const probe = layout(take, seg, def, spans, first, final, { ...o0, finalHoldTicks: 0 }, 1);
    const rest = probe.reduce((s, c) => s + c.outFrames, 0);
    o = { ...o0, finalHoldTicks: Math.max(12, Math.min(o0.finalHoldTicks, target - rest)), maxActionSpeed: 1 };
  }
  let dropped = 0;
  let speed = 1;
  let note = '';
  for (;;) {
    const probe = layout(take, seg, def, spans, first, final, o, 1);
    const actionFrames = probe.filter((c) => c.role === 'action').reduce((s, c) => s + c.outFrames, 0);
    const fixed = probe.reduce((s, c) => s + c.outFrames, 0) - actionFrames;
    const avail = Math.max(8, target - fixed);
    speed = Math.max(1, actionFrames / avail);
    if (speed <= o.maxActionSpeed || spans.length <= 2) break;
    // over budget even at max speed → drop the least informative non-essential span (never the first/last)
    let worst = -1;
    let worstD = Infinity;
    for (let i = 1; i < spans.length - 1; i++) {
      if (spans[i].essential) continue;
      const d = spans[i].intensity / (spans[i].b - spans[i].a + 1);
      if (d < worstD) { worstD = d; worst = i; }
    }
    if (worst < 0) break;
    spans.splice(worst, 1);
    dropped++;
  }
  if (speed > o.maxActionSpeed) { speed = o.maxActionSpeed; note = 'материала больше, чем помещается в целевую длительность'; }
  const clips = layout(take, seg, def, spans, first, final, o, speed);
  const outFrames = clips.reduce((s, c) => s + c.outFrames, 0);
  if (isReveal) note = '';
  if (!note && outFrames < target * 0.7) note = 'этап короче целевой длительности (материала меньше)';
  return { clips, outFrames, speed, dropped, note };
}

/**
 * Event-driven edit: for every stage pick the valid material from the best take lineage, keep
 * "start → action → result", compress waiting/travel, speed up repetitive action to fit the target.
 * Stages without valid material are reported in `needsRetake` instead of being faked.
 */
export function buildTimeline(project: Project, keys: string[], o: EditOptions = DEFAULT_EDIT): Timeline {
  const takes = project.takes;
  const stages = project.scenario.stages;
  const { take: best, valid } = bestLineage(takes, keys);
  const clips: Clip[] = [];
  const summaries: StageSummary[] = [];
  for (let i = 0; i < Math.min(valid, stages.length); i++) {
    const prod = producer(best!, i, takes)!;
    const seg = prod.segments.find((s) => s.stage === i)!;
    const b = selectStage(prod, seg, stages[i], i === 0, i === stages.length - 1, o);
    clips.push(...b.clips);
    summaries.push({
      stageId: stages[i].id, takeId: prod.id, targetFrames: Math.round(stages[i].targetSec * 30), outFrames: b.outFrames,
      naturalTicks: seg.endTick - seg.startTick, actionSpeed: Math.round(b.speed * 100) / 100, droppedSpans: b.dropped, note: b.note,
    });
  }
  const needsRetake: Timeline['needsRetake'] = [];
  for (let i = valid; i < stages.length; i++) {
    const hasMaterial = takes.some((t) => producer(t, i, takes)?.segments.some((s) => s.stage === i && s.completed));
    needsRetake.push({ stageId: stages[i].id, reason: hasMaterial ? 'STALE' : 'MISSING' });
  }
  return { fps: 30, clips, totalFrames: clips.reduce((s, c) => s + c.outFrames, 0), stages: summaries, needsRetake };
}
