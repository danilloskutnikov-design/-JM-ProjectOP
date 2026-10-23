import { secToTicks } from '../core/index.ts';
import type { Registry } from '../core/index.ts';
import { Game } from '../phonecase/index.ts';
import type { GameConfig } from '../phonecase/index.ts';
import { Bot } from '../bots/index.ts';
import type { GameEvent, Segment, Take, TakeError } from '../schema/index.ts';

export interface RunOptions {
  id: string;
  cfg: GameConfig;
  registry: Registry;
  seed: number;
  persona: string;
  speed: number;
  stageKeys: string[];
  /** Continue from the state at the start of `parent.stage` of an existing take (targeted retake). */
  parent?: { take: Take; stage: number; takes: Take[] } | null;
  maxSeconds?: number;
  stallSeconds?: number;
  tailTicks?: number;
}

export function advance(g: Game, take: Take, untilTick: number): void {
  while (g.tick < untilTick) {
    const a = take.actions[g.tick - take.startTick];
    if (!a) break;
    g.step({ x: a[0], y: a[1], down: a[2] === 1 });
  }
}

/** Game state at the moment `take` begins (replays the ancestry; no events are emitted). */
export function startState(cfg: GameConfig, registry: Registry, takes: Take[], take: Take): Game {
  if (!take.parent) {
    const g = new Game(cfg, registry);
    g.begin();
    return g;
  }
  const parent = takes.find((t) => t.id === take.parent!.takeId);
  if (!parent) throw new Error(`take ${take.id}: parent ${take.parent.takeId} not found`);
  const g = startState(cfg, registry, takes, parent);
  advance(g, parent, take.startTick);
  return g;
}

export function segmentsFrom(events: GameEvent[], lastTick: number): Segment[] {
  const segs: Segment[] = [];
  for (const e of events) {
    if (e.type === 'stage.started') {
      segs.push({ stage: e.data.index as number, stageId: e.stageId, startTick: e.tick, endTick: lastTick, completed: false });
    } else if (e.type === 'stage.completed') {
      const s = segs[segs.length - 1];
      if (s && s.stageId === e.stageId) { s.endTick = e.tick; s.completed = true; }
    }
  }
  return segs;
}

export function runTake(o: RunOptions): Take {
  const events: GameEvent[] = [];
  let g: Game;
  let startTick = 0;
  let startStage = 0;
  let parentRef: Take['parent'] = null;

  if (o.parent) {
    const pt = o.parent.take;
    const pseg = pt.segments.find((s) => s.stage === o.parent!.stage);
    if (!pseg) throw new Error(`take ${pt.id} has no segment for stage ${o.parent.stage}`);
    g = startState(o.cfg, o.registry, o.parent.takes, pt);
    advance(g, pt, pseg.startTick);
    if (g.tick !== pseg.startTick) throw new Error('parent actions do not reach the requested stage');
    startTick = g.tick;
    startStage = o.parent.stage;
    parentRef = { takeId: pt.id, stage: o.parent.stage };
    g.sink = (e) => events.push(e);
    g.emit('stage.started', { index: g.stageIndex, resumed: true });
  } else {
    g = new Game(o.cfg, o.registry);
    g.sink = (e) => events.push(e);
    g.begin();
  }
  const initialStateHash = g.stateHash();

  const bot = new Bot(o.registry, o.seed, o.persona, o.speed);
  const maxTicks = secToTicks(o.maxSeconds ?? 120);
  const stallTicks = secToTicks(o.stallSeconds ?? 8);
  const actions: Take['actions'] = [];
  let error: TakeError | undefined;
  let stageSeen = g.stageIndex;
  let best = -1;
  let bestTick = g.tick;

  try {
    while (!g.finished) {
      if (g.tick - startTick >= maxTicks) {
        error = { code: 'TIMEOUT', stage: g.currentStage().id, tick: g.tick, message: `take exceeded ${o.maxSeconds ?? 120}s` };
        break;
      }
      const input = bot.act(g);
      actions.push([input.x, input.y, input.down ? 1 : 0]);
      g.step(input);
      if (g.stageIndex !== stageSeen) { stageSeen = g.stageIndex; best = -1; bestTick = g.tick; }
      const p = g.finished ? 1 : g.currentProgress();
      if (p > best + 0.001) { best = p; bestTick = g.tick; }
      else if (g.tick - bestTick >= stallTicks) {
        error = {
          code: 'STAGE_STALLED', stage: g.currentStage().id, tick: g.tick,
          message: `no progress in stage "${g.currentStage().id}" for ${o.stallSeconds ?? 8}s (progress ${p.toFixed(3)})`,
        };
        break;
      }
    }
  } catch (e) {
    error = { code: 'BOT_ERROR', stage: g.currentStage().id, tick: g.tick, message: e instanceof Error ? e.message : String(e) };
  }

  if (error) {
    g.emit('capture.failed', { code: error.code, message: error.message });
  } else {
    const tail = o.tailTicks ?? 45;
    for (let i = 0; i < tail; i++) {
      const input = bot.idle(g);
      actions.push([input.x, input.y, input.down ? 1 : 0]);
      g.step(input);
    }
  }

  return {
    id: o.id,
    seed: o.seed,
    persona: o.persona,
    speed: o.speed,
    startStage,
    parent: parentRef,
    startTick,
    initialStateHash,
    stageKeys: o.stageKeys,
    status: error ? 'failed' : 'ok',
    error,
    ticks: actions.length,
    actions,
    intents: bot.intents,
    events,
    segments: segmentsFrom(events, g.tick),
    finalStateHash: g.stateHash(),
  };
}

/** Forward-only player used by the renderer: gives the game state at any tick of a take. */
export class TakePlayer {
  g: Game;
  take: Take;
  constructor(cfg: GameConfig, registry: Registry, takes: Take[], take: Take) {
    this.take = take;
    this.g = startState(cfg, registry, takes, take);
  }
  advanceTo(tick: number): Game {
    if (tick < this.g.tick) throw new Error(`TakePlayer is forward-only (at ${this.g.tick}, asked ${tick})`);
    while (this.g.tick < tick) {
      const i = this.g.tick - this.take.startTick;
      const a = this.take.actions[i] ?? this.take.actions[this.take.actions.length - 1];
      if (!a) break;
      this.g.step({ x: a[0], y: a[1], down: a[2] === 1 });
    }
    return this.g;
  }
}

export interface VerifyResult { ok: boolean; problems: string[] }

/**
 * Replay a take from its recorded actions only (no bot) and compare with the recording.
 * `untilTick` limits the check to a valid prefix (used when later stages are stale).
 */
export function verifyTake(cfg: GameConfig, registry: Registry, takes: Take[], take: Take, untilTick?: number): VerifyResult {
  const problems: string[] = [];
  const g = startState(cfg, registry, takes, take);
  if (g.stateHash() !== take.initialStateHash) problems.push('initial state differs from the recording');
  const events: GameEvent[] = [];
  g.sink = (e) => events.push(e);
  // startState() suppresses the opening event; re-emit it exactly as runTake() recorded it
  g.emit('stage.started', take.parent ? { index: g.stageIndex, resumed: true } : { index: g.stageIndex });
  const limit = untilTick ?? take.startTick + take.actions.length;
  advance(g, take, limit);
  const norm = (list: GameEvent[]) => JSON.stringify(list.filter((e) => e.type !== 'capture.failed' && e.tick <= limit));
  if (norm(events) !== norm(take.events)) problems.push('event log differs from the recording');
  if (untilTick === undefined && g.stateHash() !== take.finalStateHash) problems.push('final state differs from the recording');
  return { ok: problems.length === 0, problems };
}
