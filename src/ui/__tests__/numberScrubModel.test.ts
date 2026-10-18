import { describe, it, expect } from 'vitest';
import { perPixel, roundToStep, scrubDelta } from '../numberScrubModel';

describe('number field drag', () => {
  it('a bounded field sweeps its span in ~300 px, never finer than a step', () => {
    expect(perPixel({ value: 0, min: 0, max: 3, step: 0.001 })).toBeCloseTo(0.01);
    expect(perPixel({ value: 0, min: 0, max: 10, step: 1 })).toBe(1);
    expect(scrubDelta(300, { value: 0, min: -4, max: 4, step: 0.01 })).toBeCloseTo(8);
  });
  it('an open-ended field follows the value size (Unity rule)', () => {
    expect(perPixel({ value: 0, min: NaN, max: NaN, step: NaN })).toBeCloseTo(0.03);
    expect(perPixel({ value: 100, min: NaN, max: NaN, step: NaN })).toBeCloseTo(0.3);
  });
  it('rounds to the step without float noise', () => {
    expect(roundToStep(0.30000000004, 0.01)).toBe(0.3);
    expect(roundToStep(7.4, 1)).toBe(7);
    expect(roundToStep(1.234567, NaN)).toBe(1.2346);
    expect(roundToStep(0.1 + 0.2, 0.05)).toBe(0.3);
  });
});
