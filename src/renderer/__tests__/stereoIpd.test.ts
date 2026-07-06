import { describe, it, expect } from 'vitest';
import { worldIpdFromCm } from '../stereoIpd';

/**
 * Shared cm → world-unit IPD convention (AUDIT.md item 28 follow-up).
 * Both stereo surfaces (anaglyph, side-by-side recording) route through
 * this single function; these tests pin the convention down.
 */
describe('worldIpdFromCm', () => {
  it('maps cm directly to cm/100 world units for a 1-unit-wide mesh', () => {
    expect(worldIpdFromCm(6.4, 1)).toBeCloseTo(0.064, 10);
  });

  it('scales proportionally with mesh width', () => {
    expect(worldIpdFromCm(6.4, 10)).toBeCloseTo(0.64, 10);
    expect(worldIpdFromCm(6.4, 0.5)).toBeCloseTo(0.032, 10);
  });

  it('falls back to plain cm-to-units on a degenerate bbox', () => {
    expect(worldIpdFromCm(6.4, 0)).toBeCloseTo(0.064, 10);
    expect(worldIpdFromCm(6.4, -3)).toBeCloseTo(0.064, 10);
    expect(worldIpdFromCm(6.4, NaN)).toBeCloseTo(0.064, 10);
    expect(worldIpdFromCm(6.4, Infinity)).toBeCloseTo(0.064, 10);
  });

  it('clamps the cm floor at 0.1 so eye separation never hits zero', () => {
    expect(worldIpdFromCm(0, 1)).toBeCloseTo(0.001, 10);
    expect(worldIpdFromCm(-5, 1)).toBeCloseTo(0.001, 10);
  });
});
