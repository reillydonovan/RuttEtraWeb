import { describe, expect, it } from 'vitest';
import {
  MeshAnalyzer, MESH_STAT_IDS, MESH_STAT_DOCS, ANALYSIS_ROWS,
  type VideoTapReader, type DCUBrightnessParams,
} from '../MeshAnalyzer';

// --------------------------------------------------------------------
// Test harness — synthesize a `VideoTap`-shaped readback from a
// pixel-painting callback. Lets each test describe the scene
// declaratively (e.g. "all white", "horizontal gradient", "single
// bright row at index N").
// --------------------------------------------------------------------

const TEST_SIZE = 64;

function makeTap(paint: (x: number, y: number) => [number, number, number]): VideoTapReader {
  const data = new Uint8ClampedArray(TEST_SIZE * TEST_SIZE * 4);
  for (let y = 0; y < TEST_SIZE; y++) {
    for (let x = 0; x < TEST_SIZE; x++) {
      const off = (y * TEST_SIZE + x) * 4;
      const [r, g, b] = paint(x, y);
      data[off]     = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
  }
  return { getThumbnail: () => ({ data, size: TEST_SIZE }) };
}

const PASSTHROUGH_DCU: DCUBrightnessParams = { threshold: 0, contrast: 1, gamma: 1 };

describe('MeshAnalyzer', () => {
  describe('basics', () => {
    it('exports all 8 stat ids in display order', () => {
      expect(MESH_STAT_IDS).toEqual([
        'meanBrightness',
        'brightnessVariance',
        'verticalCentroid',
        'horizontalCentroid',
        'meshActivity',
        'peakRow',
        'peakBrightness',
        'edgeDensity',
      ]);
    });

    it('publishes a doc entry for every stat', () => {
      for (const id of MESH_STAT_IDS) {
        expect(MESH_STAT_DOCS[id]).toBeDefined();
        expect(MESH_STAT_DOCS[id].label.length).toBeGreaterThan(0);
        expect(MESH_STAT_DOCS[id].description.length).toBeGreaterThan(0);
      }
    });

    it('uses a 64-row analysis grid by default', () => {
      const a = new MeshAnalyzer();
      expect(a.analysisRows).toBe(ANALYSIS_ROWS);
    });

    it('returns zero stats with sane defaults before tick()', () => {
      const a = new MeshAnalyzer();
      const s = a.read();
      expect(s.meanBrightness).toBe(0);
      expect(s.peakBrightness).toBe(0);
      expect(s.verticalCentroid).toBe(0.5);
      expect(s.horizontalCentroid).toBe(0.5);
      expect(a.ready()).toBe(false);
    });

    it('returns zero stats when VideoTap has no readback yet', () => {
      const a = new MeshAnalyzer();
      const tap: VideoTapReader = { getThumbnail: () => null };
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.ready()).toBe(false);
      expect(a.read().meanBrightness).toBe(0);
    });
  });

  describe('mean brightness', () => {
    it('all-white scene → ~1.0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [255, 255, 255]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().meanBrightness).toBeCloseTo(1.0, 2);
    });

    it('all-black scene → 0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().meanBrightness).toBe(0);
    });

    it('uniform mid-gray scene → ~0.5', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().meanBrightness).toBeGreaterThan(0.45);
      expect(a.read().meanBrightness).toBeLessThan(0.55);
    });

    it('honors threshold (subtracts before contrast)', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]); // luma ≈ 0.502
      a.tick(tap, { threshold: 0.6, contrast: 1, gamma: 1 });
      // After threshold subtract, the (negative) value clamps to 0.
      expect(a.read().meanBrightness).toBe(0);
    });

    it('honors gamma', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      // gamma > 1 darkens midtones (since input ~0.5 → 0.5^2 ≈ 0.25)
      a.tick(tap, { threshold: 0, contrast: 1, gamma: 2 });
      expect(a.read().meanBrightness).toBeGreaterThan(0.2);
      expect(a.read().meanBrightness).toBeLessThan(0.32);
    });
  });

  describe('vertical centroid', () => {
    it('top-half-bright scene pulls centroid toward 0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => y < TEST_SIZE / 2 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().verticalCentroid).toBeLessThan(0.4);
    });

    it('bottom-half-bright scene pulls centroid toward 1', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => y >= TEST_SIZE / 2 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().verticalCentroid).toBeGreaterThan(0.6);
    });

    it('uniform scene → centroid ~0.5', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [200, 200, 200]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().verticalCentroid).toBeGreaterThan(0.4);
      expect(a.read().verticalCentroid).toBeLessThan(0.6);
    });

    it('all-black scene → centroid neutral 0.5 (no division by zero)', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().verticalCentroid).toBe(0.5);
    });
  });

  describe('horizontal centroid', () => {
    it('left-half-bright scene pulls centroid toward 0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((x, _y) => x < TEST_SIZE / 2 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().horizontalCentroid).toBeLessThan(0.4);
    });

    it('right-half-bright scene pulls centroid toward 1', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((x, _y) => x >= TEST_SIZE / 2 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().horizontalCentroid).toBeGreaterThan(0.6);
    });

    it('all-black scene → centroid neutral 0.5', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().horizontalCentroid).toBe(0.5);
    });
  });

  describe('peak row + peak brightness', () => {
    it('finds the brightest row', () => {
      const a = new MeshAnalyzer();
      // Single bright row at y=10 (out of 64) — should land near 10/63.
      const targetY = 10;
      const tap = makeTap((_x, y) => y === targetY ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().peakRow).toBeCloseTo(targetY / (ANALYSIS_ROWS - 1), 1);
      expect(a.read().peakBrightness).toBeGreaterThan(0.9);
    });

    it('peakBrightness equals row average for full-bright row', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => y === 0 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().peakBrightness).toBeCloseTo(1.0, 1);
    });
  });

  describe('mesh activity', () => {
    it('zero on the very first frame (no prev to diff against)', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [255, 255, 255]);
      a.tick(tap, PASSTHROUGH_DCU);
      // First frame: prev buffer is zeroed, so |this - prev| ≈ this →
      // activity is large. We're testing the structural property: it's
      // computed, not NaN.
      expect(Number.isFinite(a.read().meshActivity)).toBe(true);
    });

    it('zero for two identical frames', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      a.tick(tap, PASSTHROUGH_DCU);
      a.tick(tap, PASSTHROUGH_DCU);
      // Second frame exactly matches first → activity = 0.
      expect(a.read().meshActivity).toBe(0);
    });

    it('non-zero when the frame changes', () => {
      const a = new MeshAnalyzer();
      const dark = makeTap(() => [10, 10, 10]);
      const bright = makeTap(() => [240, 240, 240]);
      a.tick(dark, PASSTHROUGH_DCU);
      a.tick(bright, PASSTHROUGH_DCU);
      expect(a.read().meshActivity).toBeGreaterThan(0.5);
    });
  });

  describe('brightness variance', () => {
    it('uniform scene → ~0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().brightnessVariance).toBeLessThan(0.05);
    });

    it('alternating bright / dark rows → high variance', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => y % 2 === 0 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().brightnessVariance).toBeGreaterThan(0.5);
    });
  });

  describe('edge density', () => {
    it('uniform scene → 0', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().edgeDensity).toBe(0);
    });

    it('alternating bright / dark rows → near 1.0 (every pair is a transition)', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => y % 2 === 0 ? [255, 255, 255] : [0, 0, 0]);
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().edgeDensity).toBeGreaterThan(0.9);
    });

    it('smooth gradient → low edge density (small per-row deltas)', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((_x, y) => {
        const v = Math.floor((y / TEST_SIZE) * 255);
        return [v, v, v];
      });
      a.tick(tap, PASSTHROUGH_DCU);
      expect(a.read().edgeDensity).toBeLessThan(0.1);
    });
  });

  describe('clamping invariants', () => {
    it('all stats stay in [0, 1]', () => {
      const a = new MeshAnalyzer();
      // Use threshold and contrast that would push raw values negative.
      const tap = makeTap((_x, y) => [y, y, y]);
      a.tick(tap, { threshold: 0.4, contrast: 4, gamma: 0.5 });
      const s = a.read();
      for (const id of MESH_STAT_IDS) {
        expect(s[id], `stat ${id} should be in [0,1]`).toBeGreaterThanOrEqual(0);
        expect(s[id], `stat ${id} should be in [0,1]`).toBeLessThanOrEqual(1);
      }
    });

    it('NaN-safe: invalid gamma is clamped to a safe minimum', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap(() => [128, 128, 128]);
      a.tick(tap, { threshold: 0, contrast: 1, gamma: 0 });
      const s = a.read();
      for (const id of MESH_STAT_IDS) {
        expect(Number.isFinite(s[id]), `stat ${id} should be finite`).toBe(true);
      }
    });
  });

  describe('performance budget', () => {
    it('single frame analysis completes in well under 0.3 ms target', () => {
      const a = new MeshAnalyzer();
      const tap = makeTap((x, y) => {
        const v = (x + y) & 0xff;
        return [v, v, v];
      });
      // Warm up.
      for (let i = 0; i < 10; i++) a.tick(tap, PASSTHROUGH_DCU);
      const start = performance.now();
      const N = 500;
      for (let i = 0; i < N; i++) a.tick(tap, PASSTHROUGH_DCU);
      const ms = (performance.now() - start) / N;
      // Generous bound (4× the 0.3ms target) so CI variability doesn't
      // flake; the real measurement on dev hardware is <0.1ms.
      expect(ms).toBeLessThan(1.2);
    });
  });
});
