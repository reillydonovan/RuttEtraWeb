import { describe, expect, it } from 'vitest';
import { rangeFullScaleVolts, sampleToNormalized } from '../CVInput';

describe('CVInput math helpers', () => {
  describe('rangeFullScaleVolts', () => {
    it('maps Eurorack ±5V to ±5V full-scale', () => {
      expect(rangeFullScaleVolts('+/-5V')).toBe(5);
    });
    it('maps 0–5V (gates) to 5V full-scale', () => {
      expect(rangeFullScaleVolts('0-5V')).toBe(5);
    });
    it('maps ±10V (industrial) to 10V full-scale', () => {
      expect(rangeFullScaleVolts('+/-10V')).toBe(10);
    });
    it('maps 0–10V (Buchla-ish) to 10V full-scale', () => {
      expect(rangeFullScaleVolts('0-10V')).toBe(10);
    });
  });

  describe('sampleToNormalized', () => {
    it('passes bipolar samples through unchanged', () => {
      expect(sampleToNormalized(0.5, 'bipolar', false)).toBe(0.5);
      expect(sampleToNormalized(-0.5, 'bipolar', false)).toBe(-0.5);
      expect(sampleToNormalized(0, 'bipolar', false)).toBe(0);
    });
    it('clamps out-of-range samples to ±1', () => {
      expect(sampleToNormalized(99, 'bipolar', false)).toBe(1);
      expect(sampleToNormalized(-99, 'bipolar', false)).toBe(-1);
    });
    it('remaps unipolar samples from -1..1 to 0..1', () => {
      expect(sampleToNormalized(-1, 'unipolar', false)).toBe(0);
      expect(sampleToNormalized(1, 'unipolar', false)).toBe(1);
      expect(sampleToNormalized(0, 'unipolar', false)).toBeCloseTo(0.5);
    });
    it('inverts bipolar samples when invert=true', () => {
      expect(sampleToNormalized(0.5, 'bipolar', true)).toBe(-0.5);
      expect(sampleToNormalized(-0.3, 'bipolar', true)).toBe(0.3);
    });
    it('inverts unipolar samples (note: invert flips before unipolar remap)', () => {
      // For unipolar, invert flips the sample BEFORE the 0..1 remap.
      // sample=0.5, inverted=-0.5, unipolar=(−0.5+1)*0.5 = 0.25.
      expect(sampleToNormalized(0.5, 'unipolar', true)).toBeCloseTo(0.25);
    });
  });
});
