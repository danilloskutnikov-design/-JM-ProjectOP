import type { Preset } from './presets.ts';

// ───────────── events (contract: docs/adr/0003-event-contract.md) ─────────────
export type EventType =
  | 'stage.started'
  | 'action.started'
  | 'action.progress'
  | 'action.completed'
  | 'visual.change'
  | 'stage.completed'
  | 'result.ready'
  | 'capture.failed';

export const EVENT_TYPES: EventType[] = [
  'stage.started', 'action.started', 'action.progress', 'action.completed',
  'visual.change', 'stage.completed', 'result.ready', 'capture.failed',
];

export interface GameEvent {
  type: EventType;
  /** Simulation tick (1 tick = 1/30 s). Absolute within the take lineage. */
  tick: number;
  stageId: string;
  stageType: string;
  data: Record<string, unknown>;
}

export interface PointerSample { x: number; y: number; down: boolean }

export interface Intent {
  tick: number;
  stageId: string;
  kind: string;
  data: Record<string, unknown>;
}

// ───────────── assets ─────────────
export type AssetKind = 'background' | 'drawing' | 'sticker';
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Kind-specific payload; see examples/assets. */
  data: Record<string, unknown>;
}
export interface DrawingData { strokes: Array<{ color: string; width: number; points: Array<[number, number]> }> }
export interface StickerData { shape: string; color: string; size: number }
export interface BackgroundData { top: string; bottom: string; dots: string | null }

// ───────────── scenario ─────────────
export interface StageDef {
  id: string;
  type: string;
  targetSec: number;
  params?: Record<string, number>;
}
export interface PlanIssue {
  severity: 'error' | 'warning';
  chunk: string;
  message: string;
}
export interface Plan {
  stages: StageDef[];
  issues: PlanIssue[];
  ok: boolean;
}

// ───────────── takes ─────────────
export interface TakeError { code: string; stage?: string; tick: number; message: string }
export interface Segment { stage: number; stageId: string; startTick: number; endTick: number; completed: boolean }

export interface Take {
  id: string;
  seed: number;
  persona: string;
  speed: number;
  /** Index of the first stage this take plays. */
  startStage: number;
  /** Initial state = replay of parent's actions up to the start of `parent.stage`. null for root takes. */
  parent: { takeId: string; stage: number } | null;
  startTick: number;
  initialStateHash: string;
  /** Cache key per stage (chain-hashed). Entries < startStage are copied from the parent. */
  stageKeys: string[];
  status: 'ok' | 'failed';
  error?: TakeError;
  /** Tick count produced by this take (actions.length). */
  ticks: number;
  /** One pointer sample per tick, tick = startTick + index + 1: [x, y, down]. */
  actions: Array<[number, number, 0 | 1]>;
  intents: Intent[];
  events: GameEvent[];
  segments: Segment[];
  finalStateHash: string;
}

// ───────────── editing ─────────────
export type ClipRole = 'setup' | 'travel' | 'action' | 'payoff';
export interface Clip {
  takeId: string;
  stageId: string;
  role: ClipRole;
  inTick: number;
  outTick: number;
  outFrames: number;
  reason: string;
}
export interface StageSummary {
  stageId: string;
  takeId: string;
  targetFrames: number;
  outFrames: number;
  naturalTicks: number;
  actionSpeed: number;
  droppedSpans: number;
  note: string;
}
export interface Timeline {
  fps: 30;
  clips: Clip[];
  totalFrames: number;
  stages: StageSummary[];
  /** Stages for which no valid material exists (stale after an edit, or missing). */
  needsRetake: Array<{ stageId: string; reason: 'STALE' | 'MISSING' }>;
}

// ───────────── project ─────────────
export interface StickerPlacement { asset: string; u: number; v: number; scale: number; rot: number }
export interface Scene {
  seed: number;
  caseColor: string;
  dirtLevel: number;
  background: string;
  drawing: string;
  stickers: StickerPlacement[];
}
export interface Project {
  schemaVersion: 1;
  name: string;
  preset: Preset;
  scenario: { source: string; stages: StageDef[]; speed: number; persona: string };
  scene: Scene;
  /** Asset hashes at the time of the last build (informational; staleness comes from stage keys). */
  assets: Record<string, { kind: AssetKind; hash: string }>;
  takes: Take[];
  timeline: Timeline | null;
  loop: 'off' | 'cut';
  modLock: Array<{ point: string; id: string; owner: string }>;
}
