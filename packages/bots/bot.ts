import { Rng, round } from '../core/index.ts';
import type { Registry } from '../core/index.ts';
import type { Game, Pt } from '../phonecase/index.ts';
import type { Intent, PointerSample } from '../schema/index.ts';
import { NoiseTrack, PERSONAS, planMotion } from './motion.ts';
import type { MotionCtx, Persona } from './motion.ts';
import type { BotStrategy } from './strategies.ts';
import { registerBotStrategies } from './strategies.ts';

export function registerBots(reg: Registry): void {
  for (const p of PERSONAS) reg.register('botPersona', p.id, p);
  registerBotStrategies(reg);
}

/**
 * Human-like player. Layers:
 *   strategy (what)  →  motion planner (how it moves)  →  humanizer (tremor, rounding)  →  pointer input
 * The bot only ever produces pointer samples — the same input a human would give.
 */
export class Bot {
  registry: Registry;
  persona: Persona;
  rng: Rng;
  mc: MotionCtx;
  tremX: NoiseTrack;
  tremY: NoiseTrack;
  queue: PointerSample[] = [];
  t = 0;
  /** Last planned position WITHOUT tremor, so waiting never random-walks the pointer. */
  base: Pt | null = null;
  intents: Intent[] = [];
  mem: Record<string, number> = {};

  constructor(registry: Registry, seed: number, personaId: string, speedMul: number) {
    this.registry = registry;
    this.persona = registry.get<Persona>('botPersona', personaId);
    const root = new Rng(seed);
    this.rng = root.fork('plan');
    this.mc = {
      rng: root.fork('motion'),
      persona: this.persona,
      speedMul,
      speedNoise: new NoiseTrack(root.fork('speed'), 20),
      counter: 0,
    };
    this.tremX = new NoiseTrack(root.fork('tremor-x'), 4);
    this.tremY = new NoiseTrack(root.fork('tremor-y'), 4);
  }

  act(g: Game): PointerSample {
    if (!this.base) this.base = { x: g.pointer.x, y: g.pointer.y };
    if (this.queue.length === 0) {
      const strat = this.registry.get<BotStrategy>('botStrategy', g.currentStage().type);
      const intent = strat.nextIntent(g, this);
      if (intent) {
        this.intents.push({ tick: g.tick, stageId: g.currentStage().id, kind: intent.kind, data: intent.meta });
        this.queue = planMotion(intent, this.base, this.mc, g.layout);
      }
      if (this.queue.length === 0) this.queue = [{ x: this.base.x, y: this.base.y, down: false }];
    }
    return this.humanize(this.queue.shift()!);
  }

  /** Park the tool where it is (used after the game has finished). */
  idle(g: Game): PointerSample {
    if (!this.base) this.base = { x: g.pointer.x, y: g.pointer.y };
    return this.humanize({ x: this.base.x, y: this.base.y, down: false });
  }

  humanize(s: PointerSample): PointerSample {
    this.base = { x: s.x, y: s.y };
    const amp = this.persona.tremor * (s.down ? 1 : 0.5);
    const x = s.x + this.tremX.at(this.t) * amp;
    const y = s.y + this.tremY.at(this.t) * amp;
    this.t++;
    return { x: round(x, 2), y: round(y, 2), down: s.down };
  }
}
