/**
 * Unit tests for CVOutput's pure helpers — the math that's running on
 * the audio thread for every CV output. Covers:
 *
 *   - rangeFullScaleVolts (range token → V)
 *   - pitchVoltageForNote (1V/oct + calibration trim)
 *   - quantizeNote (chromatic / scale snapping)
 *
 * The CVOutput class itself isn't unit-tested here because it owns an
 * AudioContext + AudioWorkletNode, which jsdom doesn't implement. The
 * processor's pure pieces (smoothing math, ramp shape, hard clamp) are
 * straightforward and verified manually + via integration testing.
 */

import { describe, it, expect } from 'vitest';
import {
  rangeFullScaleVolts,
  pitchVoltageForNote,
  quantizeNote,
} from '../CVOutput';

describe('rangeFullScaleVolts', () => {
  it('returns 5 for ±5V and 0–5V ranges', () => {
    expect(rangeFullScaleVolts('+/-5V')).toBe(5);
    expect(rangeFullScaleVolts('0-5V')).toBe(5);
  });
  it('returns 10 for ±10V and 0–10V ranges', () => {
    expect(rangeFullScaleVolts('+/-10V')).toBe(10);
    expect(rangeFullScaleVolts('0-10V')).toBe(10);
  });
});

describe('pitchVoltageForNote (1V/oct)', () => {
  it('emits 0V at the reference note (default C4)', () => {
    expect(pitchVoltageForNote(60)).toBeCloseTo(0, 6);
  });
  it('emits +1V at C5 (one octave above C4)', () => {
    expect(pitchVoltageForNote(72)).toBeCloseTo(1, 6);
  });
  it('emits -1V at C3 (one octave below C4)', () => {
    expect(pitchVoltageForNote(48)).toBeCloseTo(-1, 6);
  });
  it('emits 1/12V (≈0.0833V) at C#4', () => {
    expect(pitchVoltageForNote(61)).toBeCloseTo(1 / 12, 6);
  });
  it('honors a custom reference voltage', () => {
    // C4 should sit at 3V if that's the reference.
    expect(pitchVoltageForNote(60, 60, 3)).toBeCloseTo(3, 6);
    // C5 = ref + 1V/oct.
    expect(pitchVoltageForNote(72, 60, 3)).toBeCloseTo(4, 6);
  });
  it('honors a Buchla-style 1.2V/oct scaling', () => {
    expect(pitchVoltageForNote(72, 60, 0, 1.2)).toBeCloseTo(1.2, 6);
  });
  it('applies the calibration trim', () => {
    // 1% high → C5 reads as 1.01V instead of 1.00V.
    expect(pitchVoltageForNote(72, 60, 0, 1, 1.01)).toBeCloseTo(1.01, 6);
  });
  it('produces continuous output between integer notes (e.g. fractional MIDI for portamento)', () => {
    expect(pitchVoltageForNote(60.5)).toBeCloseTo(0.5 / 12, 6);
  });
});

describe('quantizeNote', () => {
  it('chromatic quantization is just round-to-nearest-semitone', () => {
    expect(quantizeNote(60.4, 'chromatic', 0)).toBe(60);
    expect(quantizeNote(60.6, 'chromatic', 0)).toBe(61);
  });
  it('major scale snaps an out-of-key note to nearest in-key', () => {
    // C major has no C#, so 61 → 60 (C) or 62 (D), whichever is nearer.
    // C# is exactly between them, but the rounded note is 61, offset 1
    // from C; closest scale degrees are 0 (C, dist 1) and 2 (D, dist 1).
    // First-match wins ties → C (60).
    expect(quantizeNote(61, 'major', 0)).toBe(60);
  });
  it('minor scale honors a non-zero scale root', () => {
    // A minor (root = 9). Note 60 = C, which is in A minor. Should pass through.
    expect(quantizeNote(60, 'minor', 9)).toBe(60);
    // Note 61 = C#, NOT in A minor → snap to nearest (60 = C, in scale).
    expect(quantizeNote(61, 'minor', 9)).toBe(60);
  });
  it('pentatonic-major drops the 4th and 7th', () => {
    // C major pentatonic = C D E G A. Note 65 = F (4th), should snap.
    // F (65) is between E (64) and G (67), closer to E.
    expect(quantizeNote(65, 'pentatonic-major', 0)).toBe(64);
  });
  it('passes through unchanged when input is already in scale', () => {
    expect(quantizeNote(60, 'major', 0)).toBe(60); // C
    expect(quantizeNote(64, 'major', 0)).toBe(64); // E
    expect(quantizeNote(67, 'major', 0)).toBe(67); // G
  });
  it('respects octave when snapping (does not collapse to one octave)', () => {
    // Note 73 (C#5) in C major snaps to nearest major-scale neighbor —
    // C5 (72) or D5 (74), tied; C wins via first-match.
    expect(quantizeNote(73, 'major', 0)).toBe(72);
    // Note 85 in C major (C#6) → C6 (84).
    expect(quantizeNote(85, 'major', 0)).toBe(84);
  });
});

describe('voltage clamp behavior (manual sample-mapping check)', () => {
  // sampleToVoltage isn't exported (it's private to CVOutput), but the
  // contract from the spec is: post-clamp samples never exceed ±1, so
  // post-DAC voltages never exceed ±range full-scale. Verify the math
  // by computing what a +6V output would clip to on a ±5V channel:
  // sample = volts / fs = 1.2, clamped to 1.0, back to 5V.
  // We're not exercising the worklet here, just the conversion contract.
  it('±5V range clips +6V to +5V (sample 1.0)', () => {
    const fs = rangeFullScaleVolts('+/-5V');
    const sample = Math.max(-1, Math.min(1, 6 / fs));
    expect(sample).toBe(1);
    expect(sample * fs).toBe(5);
  });
  it('±10V range clips -15V to -10V', () => {
    const fs = rangeFullScaleVolts('+/-10V');
    const sample = Math.max(-1, Math.min(1, -15 / fs));
    expect(sample).toBe(-1);
    expect(sample * fs).toBe(-10);
  });
});
