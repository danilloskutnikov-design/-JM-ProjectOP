/**
 * Extension registry. Stage types, bot strategies, personas, scoring rules,
 * transitions, loop strategies... are registered here by (point, id).
 * Mods (later) will register through exactly this API; the core never
 * hard-codes a lookup that bypasses it.
 */
export type ExtensionPoint =
  | 'stageType'
  | 'botStrategy'
  | 'botPersona'
  | 'scoringRule'
  | 'transition'
  | 'loopStrategy'
  | 'formatPreset'
  | 'scenarioParser';

interface Entry { impl: unknown; enabled: boolean; owner: string }

export class Registry {
  points: Map<string, Map<string, Entry>> = new Map();

  register<T>(point: ExtensionPoint, id: string, impl: T, owner = 'core'): void {
    let m = this.points.get(point);
    if (!m) { m = new Map(); this.points.set(point, m); }
    if (m.has(id)) throw new Error(`registry: ${point}/${id} already registered`);
    m.set(id, { impl, enabled: true, owner });
  }
  has(point: ExtensionPoint, id: string): boolean {
    const e = this.points.get(point)?.get(id);
    return !!e && e.enabled;
  }
  get<T>(point: ExtensionPoint, id: string): T {
    const e = this.points.get(point)?.get(id);
    if (!e) throw new Error(`registry: ${point}/${id} is not registered`);
    if (!e.enabled) throw new Error(`registry: ${point}/${id} is disabled`);
    return e.impl as T;
  }
  list(point: ExtensionPoint): string[] {
    const m = this.points.get(point);
    if (!m) return [];
    return [...m.entries()].filter(([, e]) => e.enabled).map(([id]) => id).sort();
  }
  setEnabled(point: ExtensionPoint, id: string, enabled: boolean): void {
    const e = this.points.get(point)?.get(id);
    if (!e) throw new Error(`registry: ${point}/${id} is not registered`);
    e.enabled = enabled;
  }
  disableOwner(owner: string): void {
    for (const m of this.points.values()) for (const e of m.values()) if (e.owner === owner) e.enabled = false;
  }
  /** What a project needs to be reproducible (goes into project.modLock later). */
  snapshot(): Array<{ point: string; id: string; owner: string }> {
    const out: Array<{ point: string; id: string; owner: string }> = [];
    for (const [point, m] of this.points) for (const [id, e] of m) if (e.enabled) out.push({ point, id, owner: e.owner });
    return out.sort((a, b) => (a.point + a.id < b.point + b.id ? -1 : 1));
  }
}
