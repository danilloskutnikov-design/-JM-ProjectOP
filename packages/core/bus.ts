export class EventBus<E> {
  subs: Array<(e: E) => void> = [];
  on(fn: (e: E) => void): () => void {
    this.subs.push(fn);
    return () => { this.subs = this.subs.filter((f) => f !== fn); };
  }
  emit(e: E): void {
    for (const f of this.subs) f(e);
  }
}
