import { describe, expect, it } from 'vitest';
import { runNode } from './helpers';
import { getDef } from '../registry';

const fakeFft = (env: number, bands: number[] = [0.1, 0.2, 0.3, 0.4]) => ({
  bands: Float32Array.from(bands),
  getEnvelope: () => env,
});

describe('audio-envelope', () => {
  it('returns 0 when no fft is wired', () => {
    expect(runNode('audio-envelope', 1).out).toBe(0);
  });
  it('passes through getEnvelope and applies gain', () => {
    expect(runNode('audio-envelope', 1, {
      deps: { fft: fakeFft(0.4) },
      params: { gain: 2 },
    }).out).toBeCloseTo(0.8);
  });
  it('bipolar maps 0..1 to -1..+1', () => {
    expect(runNode('audio-envelope', 1, {
      deps: { fft: fakeFft(0.5) },
      params: { bipolar: true },
    }).out).toBeCloseTo(0);
  });
});

describe('audio-band', () => {
  it('returns 0 when no fft', () => {
    expect(runNode('audio-band', 1).out).toBe(0);
  });
  it('reads the chosen band index', () => {
    expect(runNode('audio-band', 1, {
      deps: { fft: fakeFft(0, [0.0, 0.5, 0.1]) },
      params: { band: 1 },
    }).out).toBeCloseTo(0.5);
  });
  it('clamps band index to bounds', () => {
    expect(runNode('audio-band', 1, {
      deps: { fft: fakeFft(0, [0.1, 0.2]) },
      params: { band: 999 },
    }).out).toBeCloseTo(0.2);
  });
  it('zeros below floor', () => {
    expect(runNode('audio-band', 1, {
      deps: { fft: fakeFft(0, [0.05]) },
      params: { band: 0, floor: 0.1 },
    }).out).toBe(0);
  });
});

describe('audio-pitch', () => {
  it('returns 0 when no fft', () => {
    expect(runNode('audio-pitch', 1).out).toBe(0);
  });
  it('detects a pure 440Hz tone within band', () => {
    const sr = 48000;
    const buf = new Float32Array(2048);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(2 * Math.PI * 440 * i / sr);
    const fft = {
      bands: new Float32Array(32),
      getEnvelope: () => 0.5,
      getTimeDomain: (out: Float32Array) => { out.set(buf); return true; },
    };
    let last = 0;
    runNode('audio-pitch', 30, {
      deps: { fft },
      params: { minHz: 100, maxHz: 1000, smoothMs: 5 },
      onTick: (_f, o) => { last = o.out; },
    });
    // 440 -> normalized t = (440 - 100) / 900 = 0.378.
    expect(last).toBeGreaterThan(0.3);
    expect(last).toBeLessThan(0.5);
  });
  it('quiet input produces no detection', () => {
    const fft = {
      bands: new Float32Array(32),
      getEnvelope: () => 0,
      getTimeDomain: (out: Float32Array) => { out.fill(0); return true; },
    };
    expect(runNode('audio-pitch', 5, { deps: { fft } }).out).toBe(0);
  });
});

describe('audio-onset', () => {
  it('outputs 0 with no audio', () => {
    expect(runNode('audio-onset', 1).out).toBe(0);
  });
  it('decays after a beat pulse', () => {
    const beat = { pulse: 1 };
    const fft = { bands: new Float32Array(32), getEnvelope: () => 0 };
    const def = getDef('audio-onset')!;
    const params: Record<string, number | string | boolean> = {};
    for (const [k, spec] of Object.entries(def.params)) params[k] = spec.default;
    const state = def.init(params);
    const outs: Record<string, number> = { out: 0 };
    const ctx = { timeSec: 0, dt: 1/60, frame: 0, deps: { fft, beat }, joystick: { x:0, y:0, z:0 } };
    def.tick(ctx, state, {}, params, outs);
    const first = outs.out;
    // First frame after a beat pulse: ~1 minus one frame of decay (~0.86 with default decayMs=120).
    expect(first).toBeGreaterThan(0.7);
    beat.pulse = 0;
    let last = first;
    for (let i = 0; i < 30; i++) def.tick(ctx, state, {}, params, outs);
    last = outs.out;
    expect(last).toBeLessThan(first);
    expect(last).toBeLessThan(0.2);
  });
});
