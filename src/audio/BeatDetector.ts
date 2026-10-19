/**
 * Lightweight beat detector.
 *
 * Algorithm: spectral flux on the low-mid bands (the kick/snare region) with
 * an adaptive threshold based on the recent local mean + a multiplier of the
 * standard deviation. When flux exceeds the threshold, fire a 1.0 pulse that
 * decays exponentially over time.
 *
 * Not aubio-quality; deliberately simple. Tweakable via `setSensitivity()`.
 */

import { FFTAnalyzer } from './FFTAnalyzer';
import { nowMs } from '../platform/determinism';

const HISTORY_MS = 1500;       // adaptive-threshold window
const REFRACTORY_MS = 120;     // min gap between detected beats
const PULSE_DECAY = 4.5;       // 1/sec; higher = faster decay

export class BeatDetector {
  /** Decaying pulse value, 0..1. */
  pulse = 0;
  /** Set true to print debug numbers to console. */
  debug = false;

  private prevBands: Float32Array | null = null;
  private fluxHistory: { t: number; v: number }[] = [];
  private lastBeatAt = 0;
  private sensitivity = 1.4;
  private enabled = false;

  constructor(private fft: FFTAnalyzer) {}

  setEnabled(on: boolean): void { this.enabled = on; if (!on) this.pulse = 0; }
  setSensitivity(s: number): void { this.sensitivity = s; }

  tick(dtSec: number): void {
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - PULSE_DECAY * dtSec);
    }
    if (!this.enabled || !this.fft.running) return;

    const bands = this.fft.bands;
    const N = bands.length;
    if (N === 0) return;

    // Use the bottom ~25% of bands (kick + low mids).
    const span = Math.max(2, Math.floor(N * 0.25));

    // Compute spectral flux: sum of positive differences vs previous frame.
    let flux = 0;
    if (this.prevBands && this.prevBands.length === N) {
      for (let i = 0; i < span; i++) {
        const d = bands[i] - this.prevBands[i];
        if (d > 0) flux += d;
      }
    }
    if (!this.prevBands || this.prevBands.length !== N) {
      this.prevBands = new Float32Array(N);
    }
    this.prevBands.set(bands);

    const now = nowMs();
    this.fluxHistory.push({ t: now, v: flux });
    while (this.fluxHistory.length > 0 && now - this.fluxHistory[0].t > HISTORY_MS) {
      this.fluxHistory.shift();
    }

    if (this.fluxHistory.length < 8) return;

    // Adaptive threshold: mean + sensitivity * stddev.
    let sum = 0;
    for (const h of this.fluxHistory) sum += h.v;
    const mean = sum / this.fluxHistory.length;
    let varSum = 0;
    for (const h of this.fluxHistory) {
      const d = h.v - mean;
      varSum += d * d;
    }
    const stddev = Math.sqrt(varSum / this.fluxHistory.length);
    const threshold = mean + this.sensitivity * stddev;

    if (flux > threshold && now - this.lastBeatAt > REFRACTORY_MS) {
      this.lastBeatAt = now;
      this.pulse = 1.0;
      if (this.debug) console.log('beat', { flux: flux.toFixed(3), threshold: threshold.toFixed(3) });
    }
  }
}
