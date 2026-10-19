import { describe, expect, it } from 'vitest';
import { parseFftFrames } from '../offline';
import { FFTAnalyzer } from '../../audio/FFTAnalyzer';

/** A tiny RWFF v1 file: fftSize 8 (4 bins), 2 frames, every bin of frame f at dbOf(f, k). */
function makeFile(dbOf: (f: number, k: number) => number, fftSize = 8, frames = 2, fps = 30): ArrayBuffer {
  const bins = fftSize / 2;
  const buf = new ArrayBuffer(24 + frames * bins * 4 + frames * fftSize * 4);
  const dv = new DataView(buf);
  'RWFF'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  [1, fftSize, 44100, fps, frames].forEach((v, i) => dv.setUint32(4 + i * 4, v, true));
  const db = new Float32Array(buf, 24, frames * bins);
  for (let f = 0; f < frames; f++) for (let k = 0; k < bins; k++) db[f * bins + k] = dbOf(f, k);
  const td = new Float32Array(buf, 24 + frames * bins * 4, frames * fftSize);
  for (let f = 0; f < frames; f++) for (let n = 0; n < fftSize; n++) td[f * fftSize + n] = f + n / 100;
  return buf;
}

describe('offline spectra (fft_frames.bin)', () => {
  it("maps dB to bytes the way Chrome's getByteFrequencyData does: clamped, truncated", () => {
    const src = parseFftFrames(makeFile((_f, k) => [-100, -90, -50, 0][k]));
    const out = new Uint8Array(4);
    src.frequency(out, -90, -10);
    // -100 below min -> 0; -90 -> 0; -50 -> 255 * 40/80 = 127.5 -> 127; 0 above max -> 255
    expect(Array.from(out)).toEqual([0, 0, 127, 255]);
  });

  it('serves the frame it is set to, for both spectrum and time domain', () => {
    const src = parseFftFrames(makeFile((f) => (f === 0 ? -90 : -10)));
    const out = new Uint8Array(4), td = new Float32Array(8);
    src.setFrame(1);
    src.frequency(out, -90, -10);
    expect(Array.from(out)).toEqual([255, 255, 255, 255]);
    src.timeDomain(td);
    expect(td[0]).toBeCloseTo(1);
    src.setFrame(0);
    src.frequency(out, -90, -10);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('rejects a file that is not RWFF v1', () => {
    const bad = makeFile(() => 0);
    new DataView(bad).setUint8(0, 0x58);
    expect(() => parseFftFrames(bad)).toThrow(/RWFF/);
  });

  it('FFTAnalyzer reads injected spectra through its normal band path, and fails loudly on an FFT size mismatch', () => {
    const fft = new FFTAnalyzer();
    fft.setBandCount(8);
    fft.setSpacing('linear');
    const src = parseFftFrames(makeFile(() => -10, 16));
    fft.attachOfflineSpectrum(src);
    expect(fft.running).toBe(true);
    fft.tick(1 / 30);
    expect(fft.bandsRaw[0]).toBeCloseTo(1);
    expect(fft.bands[0]).toBeGreaterThan(0);
    fft.setFftSize(2048);
    expect(() => fft.tick(1 / 30)).toThrow(/FFT size/);
  });
});
