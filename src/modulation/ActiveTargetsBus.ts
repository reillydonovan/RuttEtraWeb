/**
 * Pub/sub bus that tracks which engines are actively writing to which
 * Settings keys. Used to drive the "two engines touching the same knob"
 * dual-color indicator in `widgets.ts`.
 *
 * Both `ModMatrix` and `GraphEngine` call `publish(engineId, Set<paramKey>)`
 * once per `tick()`. UI widgets subscribe per-paramKey and receive a
 * `{ classic, graph }` flags object so they can show / hide the indicator.
 *
 * Kept tiny and zero-dep on purpose so the engine module stays UI-free.
 */

export type EngineId = 'classic' | 'graph';

export interface TargetActivity {
  classic: boolean;
  graph: boolean;
}

type Listener = (activity: TargetActivity) => void;

class ActiveTargetsBus {
  private byEngine: Record<EngineId, Set<string>> = {
    classic: new Set(),
    graph: new Set(),
  };
  private listeners = new Map<string, Set<Listener>>();

  publish(engineId: EngineId, targets: Set<string>): void {
    const before = this.byEngine[engineId];
    // Skip work when the set hasn't changed.
    if (sameSet(before, targets)) return;
    // Compute the union of changed keys between the two snapshots so we
    // notify only what actually flipped.
    const changed = new Set<string>();
    for (const k of before) if (!targets.has(k)) changed.add(k);
    for (const k of targets) if (!before.has(k)) changed.add(k);
    this.byEngine[engineId] = new Set(targets);
    for (const k of changed) this.notify(k);
  }

  subscribe(paramKey: string, fn: Listener): () => void {
    let s = this.listeners.get(paramKey);
    if (!s) { s = new Set(); this.listeners.set(paramKey, s); }
    s.add(fn);
    fn(this.read(paramKey));
    return () => { this.listeners.get(paramKey)?.delete(fn); };
  }

  read(paramKey: string): TargetActivity {
    return {
      classic: this.byEngine.classic.has(paramKey),
      graph: this.byEngine.graph.has(paramKey),
    };
  }

  private notify(paramKey: string): void {
    const set = this.listeners.get(paramKey);
    if (!set) return;
    const a = this.read(paramKey);
    for (const fn of set) fn(a);
  }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Singleton — modules just import this and call `publish` / `subscribe`. */
export const activeTargetsBus = new ActiveTargetsBus();
