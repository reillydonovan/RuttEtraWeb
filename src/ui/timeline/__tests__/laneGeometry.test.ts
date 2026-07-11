import { describe, it, expect } from 'vitest';
import {
  laneAxisAbs, barToX, xToBar, valueToY, yToValue,
  snapBarToBeat, findPointAt, sampleLane, dragResult,
} from '../laneGeometry';
import { evalLane } from '../../../sequencer/lanes';
import { AutomationPoint } from '../../../sequencer/types';

const pts = (...p: Array<[number, number]>): AutomationPoint[] =>
  p.map(([bar, value]) => ({ bar, value }));

describe('laneAxisAbs', () => {
  it('uses the param range directly (absolute presentation)', () => {
    expect(laneAxisAbs({ min: -1.5, max: 1.5 }, 0, [])).toEqual({ min: -1.5, max: 1.5 });
    // Base inside the range does not shift the axis.
    expect(laneAxisAbs({ min: 0, max: 2 }, 1.2, [])).toEqual({ min: 0, max: 2 });
  });

  it('expands to fit out-of-range resolved values (base + offset)', () => {
    // base 0, point offset 4 → resolved 4 sits above max 1: expand with
    // a 5%-of-span pad (0.1).
    const axis = laneAxisAbs({ min: -1, max: 1 }, 0, pts([0, 4]));
    expect(axis.max).toBeCloseTo(4.1);
    expect(axis.min).toBeCloseTo(-1);
    // A base shift pushes resolved values with it.
    const shifted = laneAxisAbs({ min: -1, max: 1 }, 2, pts([0, 4]));
    expect(shifted.max).toBeCloseTo(6.1);
  });

  it('falls back to base ± 1 for unknown or degenerate ranges', () => {
    expect(laneAxisAbs(null, 0, [])).toEqual({ min: -1, max: 1 });
    expect(laneAxisAbs({ min: 2, max: 2 }, 5, [])).toEqual({ min: 4, max: 6 });
  });
});

describe('bar/value ↔ pixel mapping', () => {
  const axis = { min: -2, max: 2 };

  it('bar ↔ x roundtrips', () => {
    expect(barToX(3.5, 60)).toBe(210);
    expect(xToBar(210, 60, 16)).toBeCloseTo(3.5);
  });

  it('xToBar clamps to [0, lengthBars]', () => {
    expect(xToBar(-50, 60, 16)).toBe(0);
    expect(xToBar(99999, 60, 16)).toBe(16);
  });

  it('value ↔ y roundtrips with 0 at center', () => {
    expect(valueToY(0, axis, 64)).toBe(32);
    expect(valueToY(2, axis, 64)).toBe(0);   // max at top
    expect(valueToY(-2, axis, 64)).toBe(64); // min at bottom
    expect(yToValue(valueToY(1.25, axis, 64), axis, 64)).toBeCloseTo(1.25);
  });

  it('yToValue clamps to the axis', () => {
    expect(yToValue(-10, axis, 64)).toBe(2);
    expect(yToValue(999, axis, 64)).toBe(-2);
  });
});

describe('snapBarToBeat', () => {
  it('rounds to the nearest beat in 4/4', () => {
    expect(snapBarToBeat(1.13, 4)).toBe(1.25);
    expect(snapBarToBeat(1.12, 4)).toBe(1);
  });

  it('handles other meters', () => {
    // 0.5 bar in 3/4 = 1.5 beats → Math.round → 2 beats = 2/3 bar.
    expect(snapBarToBeat(0.5, 3)).toBeCloseTo(2 / 3);
    expect(snapBarToBeat(0.34, 3)).toBeCloseTo(1 / 3);
  });
});

describe('findPointAt', () => {
  const points = pts([0, 0.5], [4, -1]);

  it('finds a point within epsilon of a float playhead', () => {
    const hit = findPointAt(points, 3.9999999, 1e-3);
    expect(hit).not.toBeNull();
    // The returned point carries the EXACT stored bar — the value strict
    // equality in removePointAt depends on this.
    expect(hit!.bar).toBe(4);
  });

  it('misses outside epsilon', () => {
    expect(findPointAt(points, 3.9, 1e-6)).toBeNull();
  });
});

describe('sampleLane', () => {
  it('matches evalLane at every sample including eased segments', () => {
    const points = pts([0, 0], [4, 2]);
    points[1].easing = 'easeInOut';
    const samples = sampleLane(points, 0, 4, 0.5);
    for (const [bar, value] of samples) {
      expect(value).toBeCloseTo(evalLane(points, bar));
    }
    // Both endpoints present.
    expect(samples[0][0]).toBe(0);
    expect(samples[samples.length - 1][0]).toBe(4);
  });

  it('returns empty for degenerate ranges', () => {
    expect(sampleLane(pts([0, 1]), 2, 2, 0.5)).toEqual([]);
    expect(sampleLane(pts([0, 1]), 0, 4, 0)).toEqual([]);
  });
});

describe('dragResult', () => {
  const opts = {
    pixelsPerBar: 60,
    rowHeight: 64,
    axis: { min: -2, max: 2 },
    beatsPerBar: 4,
    lengthBars: 16,
    free: false,
  };

  it('beat-snaps horizontal movement', () => {
    // 40px right of bar 2 = 2.667 bars → snaps to 2.75.
    const r = dragResult(2, 0, 40, 0, opts);
    expect(r.bar).toBe(2.75);
    expect(r.value).toBeCloseTo(0);
  });

  it('moves freely with snap disabled', () => {
    const r = dragResult(2, 0, 40, 0, { ...opts, free: true });
    expect(r.bar).toBeCloseTo(2 + 40 / 60);
  });

  it('maps vertical movement through the axis (up = positive)', () => {
    // 16px up on a 64px row over a ±2 axis = +1 offset.
    const r = dragResult(2, 0, 0, -16, opts);
    expect(r.value).toBeCloseTo(1);
  });

  it('clamps both dimensions', () => {
    const r = dragResult(0, 2, -500, -500, opts);
    expect(r.bar).toBe(0);
    expect(r.value).toBe(2);
    const r2 = dragResult(15, -2, 5000, 5000, opts);
    expect(r2.bar).toBe(16);
    expect(r2.value).toBe(-2);
  });
});
