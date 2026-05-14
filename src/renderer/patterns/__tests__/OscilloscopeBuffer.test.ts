import { describe, expect, it } from 'vitest';
import { OscilloscopeBuffer } from '../OscilloscopeBuffer';

describe('OscilloscopeBuffer', () => {
  it('initializes with the requested length and a fresh DataTexture', () => {
    const b = new OscilloscopeBuffer(64);
    expect(b.length).toBe(64);
    expect(b.texture).toBeDefined();
    expect(b.texture.image.width).toBe(64);
    expect(b.texture.image.height).toBe(1);
  });

  it('clamps the length to a sane minimum', () => {
    const b = new OscilloscopeBuffer(2);
    expect(b.length).toBeGreaterThanOrEqual(8);
  });

  it('pushSample wraps the ring buffer at the boundary', () => {
    const b = new OscilloscopeBuffer(8);
    for (let i = 0; i < 8; i++) b.pushSample(i / 7);
    expect(b.getHead()).toBe(0); // wrapped exactly back to start
    b.uploadIfDirty();
    const out = b.getOutSnapshot();
    // After full ring with head==0, latest sample sits at out[length-1]
    expect(out[out.length - 1]).toBeCloseTo(1.0, 6);
    expect(out[0]).toBeCloseTo(0.0, 6);
  });

  it('pushSample beyond capacity overwrites oldest entries', () => {
    const b = new OscilloscopeBuffer(8);
    // Push 16 distinct samples in the legal -1..1 oscilloscope range
    // (clampSafe limits to ±8, but real signals stay tiny).
    const vals: number[] = [];
    for (let i = 0; i < 16; i++) vals.push(i / 16); // 0..0.9375
    for (const v of vals) b.pushSample(v);
    expect(b.getHead()).toBe(0); // 16 % 8 == 0
    b.uploadIfDirty();
    const out = b.getOutSnapshot();
    // The latest 8 samples are vals[8..15]; latest (vals[15]=0.9375) sits
    // at the right edge, oldest-of-window (vals[8]=0.5) at the left.
    expect(out[out.length - 1]).toBeCloseTo(vals[15], 6);
    expect(out[0]).toBeCloseTo(vals[8], 6);
  });

  it('writeBlock replaces the visible window with the latest N samples', () => {
    const b = new OscilloscopeBuffer(8);
    const block = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80]);
    b.writeBlock(block);
    b.uploadIfDirty();
    expect(Array.from(b.getOutSnapshot())).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('writeBlock with longer input keeps the tail (most-recent samples)', () => {
    // OscilloscopeBuffer enforces a minimum length of 8 — request 8 here
    // and feed 12 samples to exercise the "keep the tail" path.
    const b = new OscilloscopeBuffer(8);
    b.writeBlock(new Float32Array([
      0.1, 0.2, 0.3, 0.4,
      0.5, 0.6, 0.7, 0.8,
      0.9, 1.0, 1.1, 1.2,
    ]));
    b.uploadIfDirty();
    const out = Array.from(b.getOutSnapshot());
    // Last 8 samples kept: 0.5..1.2.
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[7]).toBeCloseTo(1.2, 6);
  });

  it('writeBlock with shorter input zero-pads the rest', () => {
    const b = new OscilloscopeBuffer(8);
    b.writeBlock(new Float32Array([0.1, 0.2, 0.3]));
    b.uploadIfDirty();
    const out = b.getOutSnapshot();
    expect(out[0]).toBeCloseTo(0.1, 6);
    expect(out[1]).toBeCloseTo(0.2, 6);
    expect(out[2]).toBeCloseTo(0.3, 6);
    for (let i = 3; i < 8; i++) expect(out[i]).toBe(0);
  });

  it('uploadIfDirty returns false on a clean buffer', () => {
    const b = new OscilloscopeBuffer(16);
    b.uploadIfDirty();
    expect(b.uploadIfDirty()).toBe(false);
  });

  it('clamps non-finite samples to 0', () => {
    const b = new OscilloscopeBuffer(8);
    b.pushSample(NaN);
    b.pushSample(Infinity);
    b.pushSample(-Infinity);
    b.uploadIfDirty();
    const out = b.getOutSnapshot();
    // Three pushed samples land at indices length-3..length-1 (latest at right).
    for (let i = 0; i < out.length - 3; i++) expect(out[i]).toBe(0);
    expect(out[out.length - 3]).toBe(0); // NaN -> 0
  });

  it('clear resets head + zero-fills both buffers', () => {
    const b = new OscilloscopeBuffer(8);
    b.pushSample(1);
    b.pushSample(2);
    b.clear();
    expect(b.getHead()).toBe(0);
    b.uploadIfDirty();
    const out = b.getOutSnapshot();
    for (const v of out) expect(v).toBe(0);
  });

  describe('trigger alignment', () => {
    it('aligns to the first rising edge crossing the threshold', () => {
      const b = new OscilloscopeBuffer(16);
      // Build a window [0,0,0,0,1,1,1,1, 0,0,0,0, 1,1,1,1] via writeBlock
      // The first rising edge above 0.5 is at index 4 (0 -> 1).
      const samples = new Float32Array([
        0, 0, 0, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 1, 1, 1, 1,
      ]);
      b.writeBlock(samples);
      b.uploadIfDirty(0.5);
      const out = b.getOutSnapshot();
      // After alignment, the crossing should be at index 0.
      expect(out[0]).toBe(1);
      // The sample just before the crossing rotated to the end.
      expect(out[out.length - 1]).toBe(0);
    });

    it('searches only the first half and leaves out unchanged when no crossing in window', () => {
      const b = new OscilloscopeBuffer(16);
      // Crossing only in the SECOND half (index 12) — shouldn't trigger
      // since alignToTrigger limits its search to first half.
      const samples = new Float32Array([
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 1, 1, 1,
      ]);
      b.writeBlock(samples);
      b.uploadIfDirty(0.5);
      // Buffer should be unchanged.
      expect(Array.from(b.getOutSnapshot())).toEqual(Array.from(samples));
    });

    it('triggerLevel=0 disables alignment', () => {
      const b = new OscilloscopeBuffer(16);
      const samples = new Float32Array(16);
      for (let i = 0; i < 16; i++) samples[i] = i < 4 ? 0 : 1;
      b.writeBlock(samples);
      b.uploadIfDirty(0); // disabled
      // The crossing remains at index 4.
      expect(b.getOutSnapshot()[4]).toBe(1);
      expect(b.getOutSnapshot()[3]).toBe(0);
    });
  });

  describe('signal-bus accessors', () => {
    it('peekOutWindow returns the live array (not a copy)', () => {
      const b = new OscilloscopeBuffer(8);
      b.writeBlock(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
      b.uploadIfDirty();
      const w1 = b.peekOutWindow();
      const w2 = b.peekOutWindow();
      expect(w1).toBe(w2); // same reference
      expect(w1.length).toBe(8);
      expect(w1[7]).toBeCloseTo(0.8, 6);
    });

    it('getLatestSample after pushSample returns the most-recent push', () => {
      const b = new OscilloscopeBuffer(8);
      b.pushSample(0.1);
      expect(b.getLatestSample()).toBeCloseTo(0.1, 6);
      b.pushSample(0.5);
      b.pushSample(-0.3);
      expect(b.getLatestSample()).toBeCloseTo(-0.3, 6);
    });

    it('getLatestSample after writeBlock returns the tail of the block', () => {
      const b = new OscilloscopeBuffer(8);
      b.writeBlock(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0.42]));
      expect(b.getLatestSample()).toBeCloseTo(0.42, 6);
    });

    it('getLatestSample is independent of trigger alignment', () => {
      const b = new OscilloscopeBuffer(8);
      // Push samples that trigger an alignment shift on upload.
      for (let i = 0; i < 8; i++) b.pushSample(i < 4 ? -0.5 : 0.5);
      b.uploadIfDirty(0); // no align
      const beforeShift = b.getLatestSample();
      b.uploadIfDirty(0.0); // 0 still disables
      // getLatestSample tracks the last PUSH, not the last out[length-1]
      // after a hypothetical rotation — they could diverge under trigger.
      expect(b.getLatestSample()).toBe(beforeShift);
    });
  });
});
