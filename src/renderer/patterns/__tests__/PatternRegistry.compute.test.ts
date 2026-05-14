/**
 * Per-pattern CPU `compute()` mirror tests.
 *
 * The mirrors are the bridge between the pattern's spatial visual
 * (a fragment shader) and the modulation system (the signal bus). The
 * acceptance criteria from the spec ("Z Push wobbles in lockstep with
 * the visible Lissajous curve's horizontal motion") only holds if the
 * mirror's math agrees with the shader's. These tests pin the math.
 */

import { describe, expect, it } from 'vitest';
import { PATTERN_REGISTRY, PatternComputeFrame } from '../PatternRegistry';
import { OscilloscopeBuffer } from '../OscilloscopeBuffer';

/** Build a `PatternComputeFrame` for tests. `params` is a fixed
 *  parameter map; missing keys default to 0. */
function frame(params: Record<string, number>, overrides: Partial<PatternComputeFrame> = {}): PatternComputeFrame {
  return {
    time: 0,
    dt: 1 / 60,
    getLive: (key: string) => params[key] ?? 0,
    scope: null,
    triggerHit: false,
    ...overrides,
  };
}

describe('Sine Bands compute', () => {
  const def = PATTERN_REGISTRY.sineBands;

  it('publishes a single `wave` output', () => {
    expect(def.outputs?.map((o) => o.id)).toEqual(['wave']);
  });

  it('wave = sin(time * frequency * 2π + phase)', () => {
    const params = { patternFrequency: 1, patternPhase: 0 };
    const out0 = def.compute!(frame(params, { time: 0 }));
    expect(out0.wave).toBeCloseTo(0, 6);
    // Quarter cycle at 1 Hz is 0.25s
    const out1 = def.compute!(frame(params, { time: 0.25 }));
    expect(out1.wave).toBeCloseTo(1, 6);
    // Half cycle returns to 0
    const out2 = def.compute!(frame(params, { time: 0.5 }));
    expect(out2.wave).toBeCloseTo(0, 6);
  });

  it('phase shifts the wave', () => {
    const out = def.compute!(frame({ patternFrequency: 1, patternPhase: Math.PI / 2 }, { time: 0 }));
    expect(out.wave).toBeCloseTo(1, 6);
  });
});

describe('Triangle / Saw / Square / Pulse Bands compute', () => {
  const cases = [
    {
      name: 'triangleBands',
      // At ph=0 → -1; ph=0.5 → +1; ph=0.25 → 0
      expectations: [
        { time: 0,    expected: -1 },
        { time: 0.25, expected: 0 },
        { time: 0.5,  expected: 1 },
        { time: 0.75, expected: 0 },
      ],
    },
    {
      name: 'sawBands',
      // ph=0 → -1; ph=0.5 → 0; ph≈1 → +1
      expectations: [
        { time: 0,    expected: -1 },
        { time: 0.5,  expected: 0 },
      ],
    },
    {
      name: 'squareBands',
      // ph<0.5 → -1; ph>=0.5 → +1
      expectations: [
        { time: 0.1, expected: -1 },
        { time: 0.6, expected: 1 },
      ],
    },
  ] as const;

  for (const { name, expectations } of cases) {
    describe(name, () => {
      const def = PATTERN_REGISTRY[name];
      it('publishes a single `wave` output', () => {
        expect(def.outputs?.map((o) => o.id)).toEqual(['wave']);
      });
      for (const { time, expected } of expectations) {
        it(`wave at time=${time} is ${expected}`, () => {
          const params = { patternFrequency: 1, patternPhase: 0 };
          const out = def.compute!(frame(params, { time }));
          expect(out.wave).toBeCloseTo(expected, 5);
        });
      }
    });
  }

  it('pulseBands wave depends on Thickness (duty)', () => {
    const def = PATTERN_REGISTRY.pulseBands;
    const params = { patternFrequency: 1, patternPhase: 0, patternThickness: 0.25 };
    // ph=0.1 < 0.25 → +1
    expect(def.compute!(frame(params, { time: 0.1 })).wave).toBe(1);
    // ph=0.4 > 0.25 → -1
    expect(def.compute!(frame(params, { time: 0.4 })).wave).toBe(-1);
  });
});

describe('Lissajous compute', () => {
  const def = PATTERN_REGISTRY.lissajous;

  it('publishes both x and y outputs', () => {
    expect(def.outputs?.map((o) => o.id)).toEqual(['x', 'y']);
  });

  it('x = sin(time * 0.5 * frequency); y = sin(time * 0.5 * frequency * ratio + offset)', () => {
    // At time=0, both sin(0) = 0 (offset=0)
    let out = def.compute!(frame({
      patternFrequency: 1, patternFreqRatio: 1, patternPhaseOffset: 0,
    }, { time: 0 }));
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);

    // freqRatio=1, offset=π/2: y = sin(s * 1 + π/2) = cos(s) = 1 at s=0
    out = def.compute!(frame({
      patternFrequency: 1, patternFreqRatio: 1, patternPhaseOffset: Math.PI / 2,
    }, { time: 0 }));
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(1, 6);

    // s = time * 0.5 = π → sin(π) = 0 for X (freq=2 makes s*freq=2π)
    out = def.compute!(frame({
      patternFrequency: 2, patternFreqRatio: 2, patternPhaseOffset: 0,
    }, { time: Math.PI }));
    // s*freq = π * 2 = 2π → sin = 0
    expect(out.x).toBeCloseTo(0, 5);
  });

  it('y differs from x for non-1 freqRatio', () => {
    const out = def.compute!(frame({
      patternFrequency: 1, patternFreqRatio: 3, patternPhaseOffset: 0,
    }, { time: 1 }));
    // x = sin(0.5), y = sin(1.5) — different values
    expect(out.x).not.toBeCloseTo(out.y as number, 3);
  });
});

describe('Spiral / Gradient compute', () => {
  it('Spiral phase = sin(uPhase)', () => {
    const def = PATTERN_REGISTRY.spiral;
    expect(def.compute!(frame({ patternPhase: 0 })).phase).toBeCloseTo(0, 6);
    expect(def.compute!(frame({ patternPhase: Math.PI / 2 })).phase).toBeCloseTo(1, 6);
    expect(def.compute!(frame({ patternPhase: Math.PI })).phase).toBeCloseTo(0, 6);
  });

  it('Gradient ramp = sin(uPhase)', () => {
    const def = PATTERN_REGISTRY.gradient;
    expect(def.compute!(frame({ patternPhase: 0 })).ramp).toBeCloseTo(0, 6);
    expect(def.compute!(frame({ patternPhase: Math.PI / 2 })).ramp).toBeCloseTo(1, 6);
  });
});

describe('Oscilloscope compute', () => {
  const def = PATTERN_REGISTRY.oscilloscope;

  it('publishes latest, mean, peak, trigger', () => {
    expect(def.outputs?.map((o) => o.id).sort()).toEqual(['latest', 'mean', 'peak', 'trigger']);
  });

  it('returns zeros when no scope buffer is attached', () => {
    const out = def.compute!(frame({}, { scope: null }));
    expect(out).toEqual({ latest: 0, mean: 0, peak: 0, trigger: 0 });
  });

  it('mean is the average and peak is the max abs of the visible window', () => {
    const buf = new OscilloscopeBuffer(8);
    buf.writeBlock(new Float32Array([0.5, -0.3, 0.7, -0.1, 0.0, 0.2, -0.4, 0.6]));
    buf.uploadIfDirty();
    const out = def.compute!(frame({}, { scope: buf, triggerHit: false }));
    // sum = 0.5 - 0.3 + 0.7 - 0.1 + 0 + 0.2 - 0.4 + 0.6 = 1.2; mean = 0.15
    expect(out.mean).toBeCloseTo(0.15, 5);
    // peak abs = 0.7
    expect(out.peak).toBeCloseTo(0.7, 5);
    // latest = the last sample written via writeBlock = 0.6
    expect(out.latest).toBeCloseTo(0.6, 5);
    expect(out.trigger).toBe(0);
  });

  it('trigger output is 1 when triggerHit is true, 0 otherwise', () => {
    const buf = new OscilloscopeBuffer(8);
    buf.writeBlock(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]));
    buf.uploadIfDirty();
    expect(def.compute!(frame({}, { scope: buf, triggerHit: true })).trigger).toBe(1);
    expect(def.compute!(frame({}, { scope: buf, triggerHit: false })).trigger).toBe(0);
  });
});

describe('Pattern outputs registry-wide invariants', () => {
  it('every PatternOutputDef.range is unipolar or bipolar', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      if (!def.outputs) continue;
      for (const sig of def.outputs) {
        expect(['unipolar', 'bipolar']).toContain(sig.range);
      }
    }
  });

  it('patterns with outputs also declare a compute function', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      if (!def.outputs || def.outputs.length === 0) continue;
      expect(typeof def.compute).toBe('function');
    }
  });

  it('output IDs are unique within a pattern', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      if (!def.outputs) continue;
      const seen = new Set<string>();
      for (const sig of def.outputs) {
        expect(seen.has(sig.id)).toBe(false);
        seen.add(sig.id);
      }
    }
  });
});
