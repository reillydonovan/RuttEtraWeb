import { describe, it, expect } from 'vitest';
import {
  barToSeconds, formatTimecode, totalFrames, totalSamples, formatReadout,
} from '../timecode';

describe('barToSeconds', () => {
  it('converts at 120 BPM, 4/4 (0.5s per beat, 2s per bar)', () => {
    expect(barToSeconds(1, 120, 4)).toBeCloseTo(2);
    expect(barToSeconds(2, 120, 4)).toBeCloseTo(4);
  });

  it('scales with beatsPerBar', () => {
    expect(barToSeconds(1, 120, 3)).toBeCloseTo(1.5);
  });

  it('returns 0 for non-positive bpm (no divide-by-zero)', () => {
    expect(barToSeconds(4, 0, 4)).toBe(0);
    expect(barToSeconds(4, -10, 4)).toBe(0);
  });
});

describe('formatTimecode', () => {
  it('formats whole seconds at 30fps', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00');
    expect(formatTimecode(1, 30)).toBe('00:00:01:00');
    expect(formatTimecode(61, 30)).toBe('00:01:01:00');
    expect(formatTimecode(3661, 30)).toBe('01:01:01:00');
  });

  it('formats sub-second frame counts', () => {
    expect(formatTimecode(1.5, 30)).toBe('00:00:01:15');
    expect(formatTimecode(0.5, 24)).toBe('00:00:00:12');
  });

  it('uses the nominal (rounded) rate for the FF digit range on broadcast fps', () => {
    // 29.97 rounds to a 30-position FF range.
    const tc = formatTimecode(1, 29.97);
    expect(tc.split(':')[3].length).toBe(2);
    expect(Number(tc.split(':')[3])).toBeLessThan(30);
  });
});

describe('totalFrames / totalSamples', () => {
  it('rounds and clamps to >= 0', () => {
    expect(totalFrames(2, 30)).toBe(60);
    expect(totalFrames(-1, 30)).toBe(0);
    expect(totalSamples(1, 48000)).toBe(48000);
    expect(totalSamples(-1, 48000)).toBe(0);
  });
});

describe('formatReadout', () => {
  const bpm = 120, beatsPerBar = 4, fps = 30, sr = 48000;

  it('bars format ignores bpm/fps entirely', () => {
    expect(formatReadout('bars', 4.5, 16, bpm, beatsPerBar, fps, sr)).toBe('bar 4.50 / 16');
  });

  it('timecode/frames/samples all derive from the same bar->seconds conversion', () => {
    // bar 1 @ 120bpm/4/4 = 2s.
    expect(formatReadout('timecode', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('00:00:02:00');
    expect(formatReadout('frames', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('frame 60');
    expect(formatReadout('samples', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('smp 96000');
  });
});
