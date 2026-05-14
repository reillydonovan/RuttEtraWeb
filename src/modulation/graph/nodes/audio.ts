/**
 * Audio CV nodes — turn sound into control signals.
 *
 * These read from the existing `FFTAnalyzer` / `BeatDetector` services
 * via duck-typed interfaces (`AudioFFTLike` / `BeatLike`). The node
 * implementations contain no audio I/O themselves; if the deps are
 * missing they return 0 (matches `ModMatrix`'s behavior).
 */

import { register } from '../registry';

// ---------- audio-envelope ----------

register<{}>({
  type: 'audio-envelope',
  category: 'Audio',
  label: 'Audio Envelope',
  description: 'Broadband amplitude follower — overall input loudness.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'audio' }],
  params: {
    bipolar: { kind: 'boolean', default: false },
    gain:    { kind: 'number', min: 0, max: 4, step: 0.01, default: 1 },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const fft = ctx.deps.fft;
    if (!fft) { outputs.out = 0; return; }
    const v = fft.getEnvelope() * +(params.gain as number);
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- audio-band ----------

register<{}>({
  type: 'audio-band',
  category: 'Audio',
  label: 'Audio Band',
  description: 'Single FFT band as a CV — pick the band index, smoothing, gain.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'audio' }],
  params: {
    band:    { kind: 'number', min: 0,  max: 127, step: 1,    default: 0 },
    gain:    { kind: 'number', min: 0,  max: 4,   step: 0.01, default: 1 },
    floor:   { kind: 'number', min: 0,  max: 1,   step: 0.01, default: 0 },
    bipolar: { kind: 'boolean', default: false },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const fft = ctx.deps.fft;
    if (!fft) { outputs.out = 0; return; }
    const idx = Math.max(0, Math.min(fft.bands.length - 1, Math.round(+(params.band as number))));
    let v = fft.bands[idx] * +(params.gain as number);
    const floor = +(params.floor as number);
    if (v < floor) v = 0;
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- audio-pitch ----------

interface PitchState {
  buf: Float32Array;
  smooth: number;
  haveTimeDomain: boolean;
}

register<PitchState>({
  type: 'audio-pitch',
  category: 'Audio',
  label: 'Audio Pitch',
  description: 'Fundamental frequency tracker — output normalized over a Hz range.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'audio' }],
  params: {
    minHz:    { kind: 'number', min: 30,   max: 1000,  step: 1, default: 80 },
    maxHz:    { kind: 'number', min: 100,  max: 10000, step: 1, default: 800 },
    smoothMs: { kind: 'number', min: 0,    max: 1000,  step: 1, default: 60 },
  },
  init: () => ({ buf: new Float32Array(2048), smooth: 0, haveTimeDomain: true }),
  tick(ctx, state, _i, params, outputs) {
    const fft = ctx.deps.fft;
    if (!fft || typeof fft.getTimeDomain !== 'function' || !state.haveTimeDomain) {
      outputs.out = state.smooth;
      return;
    }
    const ok = fft.getTimeDomain(state.buf);
    if (!ok) {
      // Avoid hammering an unsupported analyzer every frame.
      state.haveTimeDomain = false;
      outputs.out = state.smooth;
      return;
    }
    // Sample-rate is unknown to the engine; we use a generic 48 kHz when
    // we have no better info. If the `audio-pitch` node ever becomes
    // misaligned across browsers we'll thread sample rate through the
    // FFTLike interface.
    const sr = 48000;
    const minHz = +(params.minHz as number);
    const maxHz = +(params.maxHz as number);
    const f = autocorrelate(state.buf, sr, minHz, maxHz);
    const t = f <= 0 ? state.smooth : (f - minHz) / Math.max(1, maxHz - minHz);
    const tau = +(params.smoothMs as number) / 1000;
    if (tau <= 0.0005) state.smooth = t;
    else state.smooth += (t - state.smooth) * (1 - Math.exp(-ctx.dt / tau));
    outputs.out = state.smooth;
  },
});

/**
 * Cheap autocorrelation pitch detector. Returns 0 if the signal is too
 * quiet to find a credible period.
 */
function autocorrelate(buf: Float32Array, sampleRate: number, minHz: number, maxHz: number): number {
  const n = buf.length;
  // RMS gate.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / n);
  if (rms < 0.005) return 0;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / minHz));
  let bestLag = -1;
  let bestVal = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < n - lag; i++) acc += buf[i] * buf[i + lag];
    if (acc > bestVal) { bestVal = acc; bestLag = lag; }
  }
  if (bestLag < 0) return 0;
  return sampleRate / bestLag;
}

// ---------- audio-onset ----------

interface OnsetState { last: number; pulse: number; }

register<OnsetState>({
  type: 'audio-onset',
  category: 'Audio',
  label: 'Audio Onset',
  description: 'Transient detector — decaying pulse on each detected onset.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'trigger' }],
  params: {
    threshold: { kind: 'number', min: 0,  max: 1,    step: 0.01, default: 0.15 },
    decayMs:   { kind: 'number', min: 10, max: 1000, step: 1,    default: 120 },
  },
  init: () => ({ last: 0, pulse: 0 }),
  tick(ctx, state, _i, params, outputs) {
    const beat = ctx.deps.beat;
    const env = ctx.deps.fft?.getEnvelope() ?? 0;
    const thresh = +(params.threshold as number);
    const decayK = 1 / Math.max(0.001, +(params.decayMs as number) / 1000);

    // Prefer a real beat detector when available; fall back to envelope
    // delta if not.
    if (beat && beat.pulse > 0.5) {
      state.pulse = 1;
    } else {
      const delta = env - state.last;
      if (delta > thresh) state.pulse = 1;
    }
    state.last = env;
    state.pulse = Math.max(0, state.pulse - ctx.dt * decayK);
    outputs.out = state.pulse;
  },
});
