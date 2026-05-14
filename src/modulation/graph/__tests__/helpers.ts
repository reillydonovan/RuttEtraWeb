/**
 * Test helpers — minimal harness for exercising single nodes and small
 * graphs without booting any of the real I/O subsystems.
 */

import '../bootstrap';
import { GraphEngine } from '../GraphEngine';
import { getDef } from '../registry';
import { GraphPatch, NodeContext, NodeDef, NodeDeps, NodeType } from '../types';

let _idCounter = 0;
export function nextId(prefix = 'n'): string {
  return `${prefix}${++_idCounter}`;
}

export function makeCtx(overrides: Partial<NodeContext> = {}): NodeContext {
  return {
    timeSec: 0,
    dt: 1 / 60,
    frame: 0,
    deps: {},
    joystick: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

/** Run a single node `n` ticks with the given inputs; return the last `out` (or full outputs). */
export function runNode(
  type: NodeType,
  ticks: number,
  opts: {
    params?: Record<string, number | string | boolean>;
    inputs?: Record<string, number>;
    deps?: NodeDeps;
    dt?: number;
    joystick?: { x: number; y: number; z: number };
    onTick?: (frame: number, outputs: Record<string, number>) => void;
  } = {},
): Record<string, number> {
  const def = getDef(type) as NodeDef<unknown> | null;
  if (!def) throw new Error(`unknown node type ${type}`);
  const params: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(def.params)) params[k] = spec.default;
  Object.assign(params, opts.params ?? {});
  const state = def.init(params);
  const outputs: Record<string, number> = {};
  for (const p of def.outputs) outputs[p.name] = 0;
  const dt = opts.dt ?? 1 / 60;
  let timeSec = 0;
  for (let i = 0; i < ticks; i++) {
    const ctx: NodeContext = {
      timeSec, dt, frame: i,
      deps: opts.deps ?? {},
      joystick: opts.joystick ?? { x: 0, y: 0, z: 0 },
    };
    for (const k of Object.keys(outputs)) outputs[k] = 0;
    def.tick(ctx, state, opts.inputs ?? {}, params, outputs);
    opts.onTick?.(i, outputs);
    timeSec += dt;
  }
  return outputs;
}

// ---- Engine harness ----

export class FakeStore {
  state = {
    modMode: 'graph' as 'classic' | 'graph' | 'both',
    zPush: 1,
    scanRate: 240,
    intensity: 1,
    bloomIntensity: 0.85,
    focus: 0,
    chromaAmount: 0.0025,
  };
  get all() { return this.state; }
  get<K extends string>(key: K): unknown {
    return (this.state as Record<string, unknown>)[key];
  }
  set<K extends string>(key: K, value: unknown): void {
    (this.state as Record<string, unknown>)[key] = value;
  }
  batchUpdate(partial: Record<string, unknown>): void {
    Object.assign(this.state, partial);
  }
  subscribe<K extends string>(_key: K, _fn: (v: unknown) => void): () => void {
    return () => {};
  }
}

/** Construct an engine with a stub Settings store and an arbitrary patch. */
export function makeEngine(patch: GraphPatch | null, deps: NodeDeps = {}): {
  engine: GraphEngine;
  store: FakeStore;
} {
  const store = new FakeStore();
  const engine = new GraphEngine(store as unknown as never, deps);
  if (patch) engine.setPatch(patch);
  return { engine, store };
}
