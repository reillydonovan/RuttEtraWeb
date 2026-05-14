import { describe, expect, it } from 'vitest';
import '../bootstrap';
import { getDef } from '../registry';
import type { NodeContext, NodeDef } from '../types';

const ctx: NodeContext = { timeSec: 0, dt: 1/60, frame: 0, deps: {}, joystick: { x:0, y:0, z:0 } };

function fresh<S>(type: string, override: Record<string, number | string | boolean> = {}): {
  def: NodeDef<S>; state: S;
  params: Record<string, number | string | boolean>;
  outs: Record<string, number>;
} {
  const def = getDef(type as never)! as NodeDef<S>;
  const params: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(def.params)) params[k] = spec.default;
  Object.assign(params, override);
  const outs: Record<string, number> = {};
  for (const p of def.outputs) outs[p.name] = 0;
  return { def, state: def.init(params), params, outs };
}

describe('trigger-to-gate', () => {
  it('opens a sustained gate on rising trigger and closes after lengthMs', () => {
    const t = fresh<unknown>('trigger-to-gate', { lengthMs: 100 });
    // Frame 0: rising edge.
    t.def.tick(ctx, t.state, { in: 1 }, t.params, t.outs);
    expect(t.outs.out).toBe(1);
    // Run 7 frames @ 1/60s = ~117ms; gate should still be high for the
    // first ~6 frames then drop.
    let highCount = 1;
    for (let i = 0; i < 12; i++) {
      t.def.tick(ctx, t.state, { in: 0 }, t.params, t.outs);
      if (t.outs.out === 1) highCount++;
    }
    expect(highCount).toBeGreaterThanOrEqual(5);
    expect(t.outs.out).toBe(0);
  });
});

describe('gate-to-trigger', () => {
  it('emits exactly one frame on rising edge', () => {
    const t = fresh<unknown>('gate-to-trigger');
    t.def.tick(ctx, t.state, { in: 1 }, t.params, t.outs); // rising
    expect(t.outs.out).toBe(1);
    t.def.tick(ctx, t.state, { in: 1 }, t.params, t.outs); // still high
    expect(t.outs.out).toBe(0);
    t.def.tick(ctx, t.state, { in: 0 }, t.params, t.outs);
    t.def.tick(ctx, t.state, { in: 1 }, t.params, t.outs); // rising again
    expect(t.outs.out).toBe(1);
  });
});

describe('clock-divider', () => {
  it('passes every Nth pulse', () => {
    const t = fresh<unknown>('clock-divider', { divisor: 3 });
    const pattern: number[] = [];
    // Rising-edge pulses pattern: 1,0,1,0,1,0,1,0,1,0,1,0
    const pulses = [1,0,1,0,1,0,1,0,1,0,1,0];
    for (const p of pulses) {
      t.def.tick(ctx, t.state, { clock: p }, t.params, t.outs);
      pattern.push(t.outs.out);
    }
    // Every 3rd rising edge should be passed.
    const passes = pattern.filter((x) => x === 1).length;
    expect(passes).toBe(2);
  });
});

describe('sequencer', () => {
  it('advances through steps on rising clock', () => {
    const t = fresh<unknown>('sequencer', {
      steps: 4, s1: 0, s2: 0.25, s3: 0.5, s4: 0.75,
    });
    // Initial state: step 0 -> s1 = 0.
    t.def.tick(ctx, t.state, {}, t.params, t.outs);
    expect(t.outs.out).toBe(0);
    // Click: step -> 1
    t.def.tick(ctx, t.state, { clock: 1 }, t.params, t.outs);
    expect(t.outs.out).toBeCloseTo(0.25);
    t.def.tick(ctx, t.state, { clock: 0 }, t.params, t.outs);
    t.def.tick(ctx, t.state, { clock: 1 }, t.params, t.outs);
    expect(t.outs.out).toBeCloseTo(0.5);
  });
  it('reset returns to step 0', () => {
    const t = fresh<unknown>('sequencer', { steps: 4, s1: 0.1, s2: 0.2, s3: 0.3, s4: 0.4 });
    t.def.tick(ctx, t.state, { clock: 1 }, t.params, t.outs);
    t.def.tick(ctx, t.state, { clock: 0 }, t.params, t.outs);
    t.def.tick(ctx, t.state, { clock: 1 }, t.params, t.outs); // step 2
    expect(t.outs.out).toBeCloseTo(0.3);
    t.def.tick(ctx, t.state, { clock: 0, reset: 1 }, t.params, t.outs);
    expect(t.outs.out).toBeCloseTo(0.1);
  });
});
