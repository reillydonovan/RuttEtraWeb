import { describe, expect, it } from 'vitest';
import { runNode } from './helpers';
import { getDef } from '../registry';
import type { NodeContext } from '../types';

const baseCtx: NodeContext = { timeSec: 0, dt: 1/60, frame: 0, deps: {}, joystick: { x:0, y:0, z:0 } };

describe('attenuator', () => {
  it('multiplies the input by level', () => {
    const out = runNode('attenuator', 1, { inputs: { in: 0.8 }, params: { level: 0.5 } });
    expect(out.out).toBe(0.4);
  });
  it('zero level fully attenuates', () => {
    const out = runNode('attenuator', 1, { inputs: { in: 1 }, params: { level: 0 } });
    expect(out.out).toBe(0);
  });
});

describe('inverter', () => {
  it('negates the input', () => {
    expect(runNode('inverter', 1, { inputs: { in: 0.7 } }).out).toBe(-0.7);
    expect(runNode('inverter', 1, { inputs: { in: 0 } }).out).toBeCloseTo(0);
  });
});

describe('offset', () => {
  it('adds bias to the input', () => {
    expect(runNode('offset', 1, { inputs: { in: 0.2 }, params: { bias: 0.3 } }).out).toBeCloseTo(0.5);
  });
});

describe('scale', () => {
  it('multiplies by the factor', () => {
    expect(runNode('scale', 1, { inputs: { in: 0.5 }, params: { factor: 3 } }).out).toBe(1.5);
  });
  it('handles negative factors', () => {
    expect(runNode('scale', 1, { inputs: { in: 1 }, params: { factor: -2 } }).out).toBe(-2);
  });
});

describe('range', () => {
  it('linearly remaps and clamps', () => {
    const o = runNode('range', 1, {
      inputs: { in: 0.5 },
      params: { inMin: 0, inMax: 1, outMin: 0, outMax: 100, clamp: true },
    });
    expect(o.out).toBe(50);
  });
  it('clamps out-of-range when clamp=true', () => {
    const o = runNode('range', 1, {
      inputs: { in: 5 },
      params: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: true },
    });
    expect(o.out).toBe(1);
  });
});

describe('mixer', () => {
  it('sums up to 4 inputs with per-channel gain', () => {
    const o = runNode('mixer', 1, {
      inputs: { in1: 0.1, in2: 0.2, in3: 0.3, in4: 0.4 },
      params: { gain1: 1, gain2: 1, gain3: 1, gain4: 1 },
    });
    expect(o.out).toBeCloseTo(1.0);
  });
  it('zero inputs -> zero out', () => {
    expect(runNode('mixer', 1).out).toBe(0);
  });
});

describe('multiplier', () => {
  it('A * B = ring mod', () => {
    expect(runNode('multiplier', 1, { inputs: { a: 0.5, b: 0.4 } }).out).toBeCloseTo(0.2);
  });
  it('silence in either input -> silence out', () => {
    expect(runNode('multiplier', 1, { inputs: { a: 0.9, b: 0 } }).out).toBe(0);
    expect(runNode('multiplier', 1, { inputs: { a: 0, b: 1 } }).out).toBe(0);
  });
});

describe('crossfade', () => {
  it('x=0 picks A, x=1 picks B, x=0.5 averages', () => {
    expect(runNode('crossfade', 1, { inputs: { a: 0.2, b: 0.8, x: 0 } }).out).toBe(0.2);
    expect(runNode('crossfade', 1, { inputs: { a: 0.2, b: 0.8, x: 1 } }).out).toBe(0.8);
    expect(runNode('crossfade', 1, { inputs: { a: 0.0, b: 1.0, x: 0.5 } }).out).toBeCloseTo(0.5);
  });
});

describe('min / max', () => {
  it('outputs minimum of supplied inputs', () => {
    expect(runNode('min', 1, { inputs: { in1: 0.4, in2: 0.1, in3: 0.7 } }).out).toBeCloseTo(0.1);
  });
  it('outputs maximum of supplied inputs', () => {
    expect(runNode('max', 1, { inputs: { in1: 0.4, in2: 0.1, in3: 0.7 } }).out).toBeCloseTo(0.7);
  });
  it('returns 0 when nothing connected', () => {
    expect(runNode('min', 1).out).toBe(0);
    expect(runNode('max', 1).out).toBe(0);
  });
});

describe('comparator', () => {
  it('outputs 1 when A > B', () => {
    expect(runNode('comparator', 1, { inputs: { a: 0.7, b: 0.3 } }).out).toBe(1);
  });
  it('outputs 0 when A <= B', () => {
    expect(runNode('comparator', 1, { inputs: { a: 0.3, b: 0.7 } }).out).toBe(0);
  });
  it('bipolar: 1 / -1', () => {
    expect(runNode('comparator', 1, { inputs: { a: 0.3, b: 0.7 }, params: { bipolar: true } }).out).toBe(-1);
  });
});

describe('sample-and-hold', () => {
  it('captures on rising edge only', () => {
    let captured = -1;
    runNode('sample-and-hold', 4, {
      onTick: (frame, o) => { if (frame === 3) captured = o.out; },
      // We need different inputs across frames; do a manual two-step run.
    });
    // Since runNode keeps inputs constant, perform two runs to verify.
    // Frame 1 rising edge with value 0.42 -> hold.
    const def = getDef('sample-and-hold')!;
    const params: Record<string, number | string | boolean> = {};
    for (const [k, spec] of Object.entries(def.params)) params[k] = spec.default;
    const state = def.init(params);
    const outs: Record<string, number> = { out: 0 };
    def.tick(baseCtx, state, { in: 0.42, trigger: 1 }, params, outs);
    expect(outs.out).toBe(0.42);
    def.tick(baseCtx, state, { in: 0.99, trigger: 1 }, params, outs);
    expect(outs.out).toBe(0.42);
    def.tick(baseCtx, state, { in: 0.99, trigger: 0 }, params, outs);
    def.tick(baseCtx, state, { in: 0.7,  trigger: 1 }, params, outs);
    expect(outs.out).toBe(0.7);
    void captured;
  });
});

describe('slew', () => {
  it('exponentially approaches target', () => {
    const samples: number[] = [];
    runNode('slew', 60, {
      inputs: { in: 1 },
      params: { riseMs: 100, fallMs: 100 },
      onTick: (_f, o) => samples.push(o.out),
    });
    // At 100ms tau, after ~5 tau (500ms = 30 frames @ 60fps) should be > 0.99
    expect(samples[30]).toBeGreaterThan(0.99);
    // Each sample should be monotonic non-decreasing.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-9);
    }
  });
});

describe('quantize', () => {
  it('snaps to N evenly-spaced steps in [inMin, inMax]', () => {
    const o = runNode('quantize', 1, {
      inputs: { in: 0.45 },
      params: { steps: 5, inMin: 0, inMax: 1 },
    });
    // 5 steps in [0,1]: 0, 0.25, 0.5, 0.75, 1. 0.45 -> 0.5 (closest higher).
    expect(o.out).toBeCloseTo(0.5);
  });
});

describe('curve', () => {
  it('linear is identity', () => {
    expect(runNode('curve', 1, { inputs: { in: 0.7 }, params: { shape: 'linear' } }).out).toBe(0.7);
  });
  it('exp pushes towards 0 in [0,1]', () => {
    const o = runNode('curve', 1, { inputs: { in: 0.5 }, params: { shape: 'exp', amount: 1 } });
    expect(o.out).toBeLessThan(0.5);
  });
});

describe('delay', () => {
  it('outputs zero on the first N frames, then echoes', () => {
    const captured: number[] = [];
    const def = getDef('delay')!;
    const params: Record<string, number | string | boolean> = { frames: 3 };
    const state = def.init(params);
    const outs: Record<string, number> = { out: 0 };
    for (let i = 0; i < 6; i++) {
      def.tick(baseCtx, state, { in: i + 1 }, params, outs);
      captured.push(outs.out);
    }
    // 3-frame delay: outs[0..2] = 0, outs[3..5] = 1, 2, 3.
    expect(captured.slice(0, 3)).toEqual([0, 0, 0]);
    expect(captured.slice(3)).toEqual([1, 2, 3]);
  });
});

describe('track-and-hold', () => {
  it('tracks while gate=1, holds when gate=0', () => {
    const def = getDef('track-and-hold')!;
    const params: Record<string, number | string | boolean> = {};
    const state = def.init(params);
    const outs: Record<string, number> = { out: 0 };
    def.tick(baseCtx, state, { in: 0.4, gate: 1 }, params, outs);
    expect(outs.out).toBe(0.4);
    def.tick(baseCtx, state, { in: 0.9, gate: 1 }, params, outs);
    expect(outs.out).toBe(0.9);
    def.tick(baseCtx, state, { in: 0.1, gate: 0 }, params, outs);
    expect(outs.out).toBe(0.9);
  });
});
