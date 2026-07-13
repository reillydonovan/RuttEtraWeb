import { describe, it, expect } from 'vitest';
import {
  barToSeconds, secondsToBar, formatTimecode, totalFrames, totalSamples, formatReadout, formatRulerTick,
  lengthDisplayFromBars, lengthBarsFromDisplay,
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

describe('secondsToBar', () => {
  it('is the inverse of barToSeconds', () => {
    expect(secondsToBar(barToSeconds(3, 120, 4), 120, 4)).toBeCloseTo(3);
    expect(secondsToBar(barToSeconds(7, 90, 3), 90, 3)).toBeCloseTo(7);
  });

  it('returns 0 for non-positive beatsPerBar (no divide-by-zero)', () => {
    expect(secondsToBar(10, 120, 0)).toBe(0);
  });
});

describe('lengthDisplayFromBars / lengthBarsFromDisplay', () => {
  const bpm = 120, bpb = 4, fps = 30, sr = 48000;

  it('bars format passes the bar count through unchanged', () => {
    expect(lengthDisplayFromBars('bars', 16, bpm, bpb, fps, sr)).toBe(16);
    expect(lengthBarsFromDisplay('bars', 16, bpm, bpb, fps, sr)).toBe(16);
  });

  it('timecode format reads/writes total runtime in seconds', () => {
    // 16 bars @ 120bpm/4-per-bar = 32s.
    expect(lengthDisplayFromBars('timecode', 16, bpm, bpb, fps, sr)).toBeCloseTo(32);
    expect(lengthBarsFromDisplay('timecode', 32, bpm, bpb, fps, sr)).toBe(16);
  });

  it('frames format reads/writes a total frame count at the notational fps', () => {
    expect(lengthDisplayFromBars('frames', 16, bpm, bpb, fps, sr)).toBe(32 * fps);
    expect(lengthBarsFromDisplay('frames', 32 * fps, bpm, bpb, fps, sr)).toBe(16);
  });

  it('samples format reads/writes a total sample count at the notational rate', () => {
    expect(lengthDisplayFromBars('samples', 16, bpm, bpb, fps, sr)).toBe(32 * sr);
    expect(lengthBarsFromDisplay('samples', 32 * sr, bpm, bpb, fps, sr)).toBe(16);
  });

  it('lengthBarsFromDisplay always rounds to a whole bar and clamps to >= 1', () => {
    expect(lengthBarsFromDisplay('timecode', 0.001, bpm, bpb, fps, sr)).toBe(1);
    expect(lengthBarsFromDisplay('bars', 3.6, bpm, bpb, fps, sr)).toBe(4);
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

  it('timecode/frames/samples all derive from the same bar->seconds conversion, and anchor to the bar position', () => {
    // bar 1 @ 120bpm/4/4 = 2s.
    expect(formatReadout('timecode', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('00:00:02:00  ·  bar 1.00');
    expect(formatReadout('frames', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('frame 60  ·  bar 1.00');
    expect(formatReadout('samples', 1, 16, bpm, beatsPerBar, fps, sr)).toBe('smp 96000  ·  bar 1.00');
  });
});

describe('formatRulerTick', () => {
  const bpm = 120, beatsPerBar = 4, fps = 30, sr = 48000;

  it('bars format is the plain bar number', () => {
    expect(formatRulerTick('bars', 0, bpm, beatsPerBar, fps, sr)).toBe('0');
    expect(formatRulerTick('bars', 8, bpm, beatsPerBar, fps, sr)).toBe('8');
  });

  it('agrees with formatReadout\'s anchor: the same bar produces the same underlying reading', () => {
    // Regression check for the reported bug — ruler showed "8" while
    // the counter (in Timecode mode) showed 16s for the same bar,
    // because the ruler never looked at the display format at all.
    const bar = 8;
    const readout = formatReadout('timecode', bar, 16, bpm, beatsPerBar, fps, sr);
    const tick = formatRulerTick('timecode', bar, bpm, beatsPerBar, fps, sr);
    expect(readout).toContain('00:00:16'); // 8 bars @ 120bpm/4/4 = 16s
    expect(tick).toBe('0:16'); // short-form ruler label for the same 16s
  });

  it('frames/samples ruler ticks match the same bar->seconds conversion as the readout', () => {
    expect(formatRulerTick('frames', 1, bpm, beatsPerBar, fps, sr)).toBe('60');
    expect(formatRulerTick('samples', 1, bpm, beatsPerBar, fps, sr)).toBe('96000');
  });

  it('short-form timecode drops hours until past one', () => {
    expect(formatRulerTick('timecode', 0, bpm, beatsPerBar, fps, sr)).toBe('0:00');
    // 1800 bars @ 120bpm/4/4 = 3600s = exactly 1 hour.
    expect(formatRulerTick('timecode', 1800, bpm, beatsPerBar, fps, sr)).toBe('1:00:00');
  });
});
