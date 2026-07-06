/**
 * v22: MIDI clock out — pure scheduling math (AUDIT item 3).
 */
import { describe, it, expect } from 'vitest';
import { schedulePulses } from '../MidiClockOut';

describe('schedulePulses', () => {
  it('emits pulses at 24 PPQ spacing for the lookahead window', () => {
    // 120 BPM -> 48 pulses/sec -> 20.833 ms apart. 250 ms window ≈ 12-13
    // pulses (float fencepost at the horizon).
    const { times, next } = schedulePulses(1000, 1000, 250, 120);
    expect(times.length).toBeGreaterThanOrEqual(12);
    expect(times.length).toBeLessThanOrEqual(13);
    expect(times[0]).toBe(1000);
    expect(times[1] - times[0]).toBeCloseTo(60000 / (120 * 24), 6);
    expect(next).toBeGreaterThanOrEqual(1250);
  });

  it('starts from nextPulseTime, not now, preserving phase continuity', () => {
    const { times } = schedulePulses(1010, 1000, 50, 120);
    expect(times[0]).toBe(1010);
  });

  it('returns nothing when the next pulse is beyond the window', () => {
    const { times, next } = schedulePulses(2000, 1000, 250, 120);
    expect(times).toEqual([]);
    expect(next).toBe(2000);
  });

  it('jumps forward instead of bursting after a long stall (tab throttle)', () => {
    // nextPulseTime is 10 s stale; a naive loop would emit ~480 pulses.
    const { times } = schedulePulses(0, 10_000, 250, 120);
    expect(times.length).toBeLessThanOrEqual(13);
    expect(times[0]).toBe(10_000);
  });

  it('tracks tempo: doubling BPM roughly doubles the pulse count', () => {
    const slow = schedulePulses(0, 0, 1000, 60).times.length;
    const fast = schedulePulses(0, 0, 1000, 120).times.length;
    // Fencepost tolerance: counts are 24/25-ish vs 48/49-ish.
    expect(fast / slow).toBeGreaterThan(1.8);
    expect(fast / slow).toBeLessThan(2.2);
  });
});
