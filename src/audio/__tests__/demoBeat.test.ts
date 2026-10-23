import { describe, it, expect } from 'vitest';
import { renderDemoBeat, DEMO_BEAT_BARS } from '../demoBeat';

const RMS = (a: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

describe('renderDemoBeat', () => {
  it('is exactly two bars long at the given BPM', () => {
    const sr = 48000;
    expect(renderDemoBeat(sr, 120).length).toBe(Math.round(DEMO_BEAT_BARS * 4 * 0.5 * sr));
    expect(renderDemoBeat(sr, 90).length).toBe(Math.round(DEMO_BEAT_BARS * 4 * (60 / 90) * sr));
  });

  it('stays within a modest peak and has no NaNs', () => {
    const a = renderDemoBeat(44100, 128);
    let peak = 0;
    for (const v of a) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); }
    expect(peak).toBeCloseTo(0.8, 5);
  });

  it('is loudest on the beat (the beat detector has something to find)', () => {
    const sr = 48000, beat = Math.round(0.5 * sr);
    const a = renderDemoBeat(sr, 120);
    const win = Math.round(0.03 * sr);
    for (let b = 0; b < 8; b++) {
      const onBeat = RMS(a, b * beat, b * beat + win);
      const between = RMS(a, b * beat + Math.round(0.4 * sr), b * beat + Math.round(0.4 * sr) + win);
      expect(onBeat).toBeGreaterThan(between * 2);
    }
  });

  it('is deterministic', () => {
    expect(renderDemoBeat(22050, 100)).toEqual(renderDemoBeat(22050, 100));
  });
});
