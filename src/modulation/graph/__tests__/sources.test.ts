import { describe, expect, it } from 'vitest';
import { runNode } from './helpers';

describe('lfo', () => {
  it('produces zero on the very first frame at default phase', () => {
    const out = runNode('lfo', 1);
    expect(Math.abs(out.out)).toBeLessThan(1e-3);
  });

  it('completes one full sine cycle at rate=1 Hz', () => {
    const samples: number[] = [];
    runNode('lfo', 60, { onTick: (_f, o) => samples.push(o.out) });
    // First sample is at phase 0 -> sin(0) = 0.
    expect(samples[0]).toBeCloseTo(0, 5);
    // The LFO actually swung between -1 and +1 within tolerance.
    expect(Math.max(...samples)).toBeGreaterThan(0.95);
    expect(Math.min(...samples)).toBeLessThan(-0.95);
  });

  it('respects bipolar=false (output is 0..1)', () => {
    const samples: number[] = [];
    runNode('lfo', 120, {
      params: { bipolar: false, rate: 1 },
      onTick: (_f, o) => samples.push(o.out),
    });
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
  });

  it('square wave snaps between +1 and -1', () => {
    const samples: number[] = [];
    runNode('lfo', 60, {
      params: { shape: 'square', rate: 0.5 },
      onTick: (_f, o) => samples.push(o.out),
    });
    for (const s of samples) expect(Math.abs(Math.abs(s) - 1)).toBeLessThan(1e-9);
  });
});

describe('ramp', () => {
  it('one-shot reaches 1 and holds', () => {
    let last = 0;
    runNode('ramp', 120, {
      params: { mode: 'one-shot', timeSec: 1, bipolar: false },
      inputs: { trigger: 1 },
      onTick: (_f, o) => { last = o.out; },
    });
    // After 2 seconds @ 60Hz with timeSec=1, should be saturated at 1.
    expect(last).toBeCloseTo(1, 2);
  });

  it('is bipolar by default', () => {
    let lo = Infinity, hi = -Infinity;
    runNode('ramp', 240, {
      params: { mode: 'up', timeSec: 1 },
      onTick: (_f, o) => { lo = Math.min(lo, o.out); hi = Math.max(hi, o.out); },
    });
    expect(lo).toBeLessThan(-0.9);
    expect(hi).toBeGreaterThan(0.9);
  });
});

describe('noise', () => {
  it('white noise stays in [-1,1]', () => {
    const samples: number[] = [];
    runNode('noise', 200, {
      params: { kind: 'white' },
      onTick: (_f, o) => samples.push(o.out),
    });
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-1.001);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.001);
  });

  it('sample-and-hold only changes on rising clock', () => {
    const seen = new Set<number>();
    let prev = NaN;
    runNode('noise', 30, {
      params: { kind: 'sample-and-hold' },
      inputs: { clock: 0 },
      onTick: (_f, o) => { seen.add(o.out); prev = o.out; },
    });
    // No rising edge -> never sampled, stayed at default 0.
    expect(seen.size).toBe(1);
    expect(prev).toBe(0);
  });
});

describe('constant', () => {
  it('emits its value param', () => {
    const out = runNode('constant', 1, { params: { value: 0.42 } });
    expect(out.out).toBe(0.42);
  });
});

describe('clock', () => {
  it('outputs a phase 0..1 cycling at the configured rate', () => {
    let lastPhase = -1;
    let wraps = 0;
    runNode('clock', 60, {
      params: { source: 'internal', bpm: 120, division: '1/4' },
      onTick: (_f, o) => {
        if (lastPhase >= 0 && o.phase < lastPhase) wraps++;
        lastPhase = o.phase;
      },
    });
    // 120 bpm = 2 quarters/sec, so over 1s we should see ~2 wraps.
    expect(wraps).toBeGreaterThanOrEqual(1);
  });
});
