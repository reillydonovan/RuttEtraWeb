import { describe, expect, it } from 'vitest';
import {
  Sonification,
  applyCurve, expRange, dbToGain, midiToHz, midiToName, readStat,
} from '../Sonification';
import { DEFAULT_SONIFICATION } from '../../state/Settings';
import type { MeshStats } from '../MeshAnalyzer';

const ZERO_STATS: MeshStats = {
  meanBrightness: 0,
  brightnessVariance: 0,
  verticalCentroid: 0.5,
  horizontalCentroid: 0.5,
  meshActivity: 0,
  peakRow: 0.5,
  peakBrightness: 0,
  edgeDensity: 0,
};

describe('Sonification helpers', () => {
  describe('applyCurve', () => {
    it('linear is identity on [0, 1]', () => {
      expect(applyCurve(0, 'linear')).toBe(0);
      expect(applyCurve(0.25, 'linear')).toBe(0.25);
      expect(applyCurve(0.5, 'linear')).toBe(0.5);
      expect(applyCurve(1, 'linear')).toBe(1);
    });

    it('exponential emphasizes the high end', () => {
      // x^2: 0.5 → 0.25 (squashed in the middle), 0.9 → 0.81 (still high)
      expect(applyCurve(0.5, 'exponential')).toBe(0.25);
      expect(applyCurve(0, 'exponential')).toBe(0);
      expect(applyCurve(1, 'exponential')).toBe(1);
    });

    it('logarithmic emphasizes the low end', () => {
      // sqrt: 0.25 → 0.5, 0.04 → 0.2
      expect(applyCurve(0.25, 'logarithmic')).toBe(0.5);
      expect(applyCurve(0.04, 'logarithmic')).toBeCloseTo(0.2, 5);
    });

    it('sCurve (smoothstep) flattens both ends', () => {
      expect(applyCurve(0, 'sCurve')).toBe(0);
      expect(applyCurve(0.5, 'sCurve')).toBe(0.5);
      expect(applyCurve(1, 'sCurve')).toBe(1);
      // Steeper than linear in the middle, flatter at the ends.
      expect(applyCurve(0.1, 'sCurve')).toBeLessThan(0.1);
      expect(applyCurve(0.9, 'sCurve')).toBeGreaterThan(0.9);
    });

    it('clamps out-of-range inputs to [0, 1]', () => {
      expect(applyCurve(-1, 'linear')).toBe(0);
      expect(applyCurve(2, 'linear')).toBe(1);
      expect(applyCurve(-0.5, 'exponential')).toBe(0);
      expect(applyCurve(NaN, 'linear')).toBe(0);
    });
  });

  describe('expRange', () => {
    it('endpoints land exactly on lo / hi', () => {
      expect(expRange(0, 60, 16000)).toBe(60);
      expect(expRange(1, 60, 16000)).toBe(16000);
    });

    it('midpoint is the geometric mean (logarithmic interpolation)', () => {
      expect(expRange(0.5, 100, 10000)).toBeCloseTo(1000, 0);
    });

    it('quarter point covers two octaves of the four-octave range', () => {
      expect(expRange(0.5, 100, 1600)).toBeCloseTo(400, 0);
    });
  });

  describe('dbToGain', () => {
    it('0 dB → unity', () => {
      expect(dbToGain(0)).toBe(1);
    });

    it('-6 dB → ~0.501', () => {
      expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
    });

    it('-18 dB (default) → ~0.126 (about 1/8 voltage)', () => {
      expect(dbToGain(-18)).toBeCloseTo(0.1259, 3);
    });

    it('-90 dB and below return 0 (true mute)', () => {
      expect(dbToGain(-90)).toBe(0);
      expect(dbToGain(-100)).toBe(0);
      expect(dbToGain(Number.NEGATIVE_INFINITY)).toBe(0);
    });

    it('NaN returns 0', () => {
      expect(dbToGain(NaN)).toBe(0);
    });
  });

  describe('midiToHz', () => {
    it('A4 (69) is 440 Hz', () => {
      expect(midiToHz(69)).toBeCloseTo(440, 5);
    });

    it('C4 (60) is ~261.63 Hz', () => {
      expect(midiToHz(60)).toBeCloseTo(261.63, 1);
    });

    it('one octave is 2x', () => {
      expect(midiToHz(81) / midiToHz(69)).toBeCloseTo(2, 5);
    });
  });

  describe('midiToName', () => {
    it('formats reference notes correctly', () => {
      expect(midiToName(60)).toBe('C4');
      expect(midiToName(69)).toBe('A4');
      expect(midiToName(36)).toBe('C2');
      expect(midiToName(84)).toBe('C6');
      expect(midiToName(61)).toBe('C#4');
    });
  });

  describe('readStat', () => {
    it('returns 0 for unmapped (empty source)', () => {
      expect(readStat(ZERO_STATS, '')).toBe(0);
    });

    it('returns the correct stat value for a valid id', () => {
      const stats: MeshStats = { ...ZERO_STATS, meanBrightness: 0.7 };
      expect(readStat(stats, 'meanBrightness')).toBe(0.7);
    });

    it('handles missing keys gracefully', () => {
      // Cast-through-unknown to feed an unknown key — the runtime
      // falls back to 0 thanks to the `?? 0`.
      expect(readStat(ZERO_STATS, 'bogus' as never)).toBe(0);
    });
  });
});

describe('Sonification class', () => {
  it('has a default config that matches DEFAULT_SONIFICATION', () => {
    expect(DEFAULT_SONIFICATION.enabled).toBe(false);
    expect(DEFAULT_SONIFICATION.masterVolumeDb).toBe(-18);
    expect(DEFAULT_SONIFICATION.waveform).toBe('sine');
    expect(DEFAULT_SONIFICATION.filterType).toBe('lowpass');
    expect(DEFAULT_SONIFICATION.quantize).toBe(true);
    expect(DEFAULT_SONIFICATION.smoothingMs).toBe(40);
    expect(DEFAULT_SONIFICATION.pitchRangeMidi).toEqual([36, 84]);
    expect(DEFAULT_SONIFICATION.mappings.pitch.source).toBe('verticalCentroid');
    expect(DEFAULT_SONIFICATION.mappings.amplitude.source).toBe('meanBrightness');
  });

  it('starts in idle status (running=false, no errors, no mic-feedback)', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    const s = son.getStatus();
    expect(s.running).toBe(false);
    expect(s.awaitingUserGesture).toBe(false);
    expect(s.micFeedbackMuted).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('subscribe fires once immediately with current status', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    let calls = 0;
    let last: { running: boolean } | null = null;
    son.subscribe((s) => { calls++; last = s; });
    expect(calls).toBe(1);
    expect(last!.running).toBe(false);
  });

  it('setMicFeedbackActive toggles the status flag and emits exactly once per change', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    let calls = 0;
    son.subscribe(() => { calls++; });
    expect(calls).toBe(1); // initial
    son.setMicFeedbackActive(true);
    expect(son.getStatus().micFeedbackMuted).toBe(true);
    expect(calls).toBe(2);
    son.setMicFeedbackActive(true); // duplicate — no emit
    expect(calls).toBe(2);
    son.setMicFeedbackActive(false);
    expect(son.getStatus().micFeedbackMuted).toBe(false);
    expect(calls).toBe(3);
  });

  it('tick() is a no-op when disabled (no AudioContext side effects in JSDOM)', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    expect(() => son.tick(ZERO_STATS, 1 / 60)).not.toThrow();
  });

  it('applyConfig with same enabled state has no effect on running status', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    son.applyConfig({ ...DEFAULT_SONIFICATION, masterVolumeDb: -12 });
    expect(son.getStatus().running).toBe(false);
  });

  it('getCaptureStream returns null before any AudioContext is built', () => {
    const son = new Sonification(DEFAULT_SONIFICATION);
    expect(son.getCaptureStream()).toBeNull();
  });

  it('setGraphValue accepts finite values and drops non-finite input safely (no AudioContext side effects in Node)', () => {
    // The 'graph' mapping source's actual audible effect can only be
    // observed with a real running AudioContext (tick() early-returns
    // while !voiceActive, same limitation the tick()-is-a-no-op test
    // above documents) — this asserts the public contract stays safe
    // to call from the audio-output graph node regardless of input.
    const son = new Sonification(DEFAULT_SONIFICATION);
    expect(() => son.setGraphValue(0.5)).not.toThrow();
    expect(() => son.setGraphValue(NaN)).not.toThrow();
    expect(() => son.setGraphValue(Infinity)).not.toThrow();
  });
});
