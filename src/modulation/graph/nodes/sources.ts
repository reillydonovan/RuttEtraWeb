/**
 * Source nodes — produce signals from "nothing":
 *   - lfo: sine/triangle/saw/square/pulse with rate, phase, duty, bipolar toggle
 *   - ramp: up/down/triangle/hold/one-shot, with rate and retrigger input
 *   - noise: white / pink / sample-and-hold (with clock input)
 *   - constant: fixed value
 *   - clock: derived ticks from internal BPM or MIDI clock; pulse out at division
 */

import { register } from '../registry';
import { divisionToBeats, ALL_DIVISIONS } from '../../tempo';
import type { ClockDivision } from '../../../state/Settings';

const TWO_PI = Math.PI * 2;

// ---------- LFO ----------

interface LFOState { phase: number; }

register<LFOState>({
  type: 'lfo',
  category: 'Sources',
  label: 'LFO',
  description: 'Low-frequency oscillator — sine/triangle/saw/square/pulse.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control', range: (p) => (p.bipolar === false ? [0, 1] : [-1, 1]) }],
  params: {
    shape:    { kind: 'enum', options: ['sine', 'triangle', 'saw', 'square', 'pulse'], default: 'sine', help: 'Waveform shape: sine is smooth, triangle is linear, saw ramps up and drops, square and pulse jump.' },
    // Floor matches the Classic slot LFO (0.001 Hz = 1000 s period) so
    // subsonic sweeps are available in both engines.
    rate:     { kind: 'number', min: 0.001, max: 30,  step: 0.001, default: 1, help: 'Speed of the oscillation, in cycles per second (Hz), before the Range multiplier.' },
    // v21: Lo/Mid/Hi range switch — ×0.01 / ×1 / ×10 on `rate`, like the
    // range switch on the original hardware's oscillators. 'high' above
    // ~20 Hz effective aliases against the frame rate (stroboscopic).
    range:    { kind: 'enum', options: ['low', 'mid', 'high'], default: 'mid', help: 'Multiplies Rate: low is x0.01 for slow sweeps, mid is x1, high is x10 (fast rates can strobe).' },
    phase:    { kind: 'number', min: 0,    max: 1,   step: 0.001, default: 0, help: 'Shifts where in its cycle the wave starts, as a fraction of one cycle (0.5 = half a cycle later).' },
    duty:     { kind: 'number', min: 0.05, max: 0.95, step: 0.01, default: 0.5, help: 'Pulse shape only: the fraction of each cycle the pulse stays high.' },
    bipolar:  { kind: 'boolean', default: true, help: 'ON swings the output -1 to +1; OFF keeps it 0 to 1.' },
  },
  init: () => ({ phase: 0 }),
  tick(ctx, state, _ins, params, outputs) {
    const rangeMult = params.range === 'low' ? 0.01 : params.range === 'high' ? 10 : 1;
    const rate = +(params.rate as number) * rangeMult;
    const offset = +(params.phase as number);
    const duty = +(params.duty as number);
    // Emit at the current phase, then advance — keeps frame 0 at phase 0
    // and matches the convention of "this frame's value is the value AT
    // this point in time".
    const t = ((state.phase + offset) % 1 + 1) % 1;
    let v = 0;
    switch (params.shape as string) {
      case 'sine':     v = Math.sin(TWO_PI * t); break;
      case 'triangle': v = 4 * Math.abs(t - 0.5) - 1; break;
      case 'saw':      v = t * 2 - 1; break;
      case 'square':   v = t < 0.5 ? 1 : -1; break;
      case 'pulse':    v = t < duty ? 1 : -1; break;
    }
    if (!(params.bipolar as boolean)) v = v * 0.5 + 0.5;
    outputs.out = v;
    state.phase = (state.phase + rate * ctx.dt) % 1;
    if (state.phase < 0) state.phase += 1;
  },
});

// ---------- Ramp ----------

interface RampState { startTime: number; lastTrigger: number; finished: boolean; }

register<RampState>({
  type: 'ramp',
  category: 'Sources',
  label: 'Ramp',
  description: 'Linear ramp generator — up/down/triangle/one-shot.',
  inputs: [{ name: 'trigger', kind: 'trigger' }],
  outputs: [{ name: 'out', kind: 'control', range: (p) => (p.bipolar === false ? [0, 1] : [-1, 1]) }],
  params: {
    mode:     { kind: 'enum', options: ['up', 'down', 'triangle', 'one-shot'], default: 'up', help: 'Ramp direction: up rises and repeats, down falls, triangle rises then falls, one-shot rises once and holds.' },
    timeSec:  { kind: 'number', min: 0.05, max: 600, step: 0.05, default: 4, help: 'How long one ramp takes, in seconds. A pulse on the trigger input restarts it.' },
    bipolar:  { kind: 'boolean', default: true, help: 'ON ramps from -1 to +1; OFF ramps from 0 to 1.' },
  },
  init: () => ({ startTime: 0, lastTrigger: 0, finished: false }),
  tick(ctx, state, ins, params, outputs) {
    const trig = ins.trigger ?? 0;
    if (trig > 0.5 && state.lastTrigger <= 0.5) {
      state.startTime = ctx.timeSec;
      state.finished = false;
    }
    state.lastTrigger = trig;
    const dur = Math.max(0.016, +(params.timeSec as number));
    let p = (ctx.timeSec - state.startTime) / dur;
    const mode = params.mode as string;
    if (mode === 'one-shot') {
      if (p >= 1) { p = 1; state.finished = true; }
      else if (p < 0) p = 0;
    } else if (mode === 'triangle') {
      p = ((p % 2) + 2) % 2;
      if (p > 1) p = 2 - p;
    } else {
      p = ((p % 1) + 1) % 1;
    }
    let v: number;
    if (mode === 'down') v = 1 - p;
    else v = p;
    if (params.bipolar as boolean) v = v * 2 - 1;
    outputs.out = v;
  },
});

// ---------- Noise ----------

interface NoiseState {
  pinkLag: number[];
  shValue: number;
  lastClock: number;
}

register<NoiseState>({
  type: 'noise',
  category: 'Sources',
  label: 'Noise',
  description: 'White / pink / sample-and-hold noise generator.',
  inputs: [{ name: 'clock', kind: 'trigger' }],
  // Pink noise is a sum of leaky integrators scaled by 0.11: it stays inside ±1 in practice,
  // though not provably (a long same-sign run can overshoot slightly).
  outputs: [{ name: 'out', kind: 'control', range: (p) => (p.bipolar === false ? [0, 1] : [-1, 1]) }],
  params: {
    kind:    { kind: 'enum', options: ['white', 'pink', 'sample-and-hold'], default: 'white', help: 'Noise type: white jitters every frame, pink drifts more smoothly, sample-and-hold steps on each clock pulse.' },
    bipolar: { kind: 'boolean', default: true, help: 'ON centres the noise on 0 (-1 to +1); OFF keeps it 0 to 1.' },
  },
  init: () => ({ pinkLag: [0, 0, 0, 0, 0, 0, 0], shValue: 0, lastClock: 0 }),
  tick(_ctx, state, ins, params, outputs) {
    const kind = params.kind as string;
    let v = 0;
    if (kind === 'white') {
      v = Math.random() * 2 - 1;
    } else if (kind === 'pink') {
      // Voss-McCartney-ish: average a few decaying low-passed white sources.
      const r = Math.random() * 2 - 1;
      const lag = state.pinkLag;
      lag[0] = 0.99886 * lag[0] + r * 0.0555179;
      lag[1] = 0.99332 * lag[1] + r * 0.0750759;
      lag[2] = 0.96900 * lag[2] + r * 0.1538520;
      lag[3] = 0.86650 * lag[3] + r * 0.3104856;
      lag[4] = 0.55000 * lag[4] + r * 0.5329522;
      lag[5] = -0.7616 * lag[5] - r * 0.0168980;
      v = lag[0] + lag[1] + lag[2] + lag[3] + lag[4] + lag[5] + lag[6] + r * 0.5362;
      v *= 0.11;
      lag[6] = r * 0.115926;
    } else {
      const trig = ins.clock ?? 0;
      if (trig > 0.5 && state.lastClock <= 0.5) {
        state.shValue = Math.random() * 2 - 1;
      }
      state.lastClock = trig;
      v = state.shValue;
    }
    if (!(params.bipolar as boolean)) v = v * 0.5 + 0.5;
    outputs.out = v;
  },
});

// ---------- Constant ----------

register<{}>({
  type: 'constant',
  category: 'Sources',
  label: 'Constant',
  description: 'Fixed value — useful as a baseline to sum against.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const v = +(p.value ?? 0); return [v, v]; } }],
  params: {
    value: { kind: 'number', min: -2, max: 2, step: 0.001, default: 0, help: 'The fixed value this node always outputs.' },
  },
  init: () => ({}),
  tick(_ctx, _state, _ins, params, outputs) {
    outputs.out = +(params.value as number);
  },
});

// ---------- Clock ----------

interface ClockState { phase: number; lastPulse: number; }

register<ClockState>({
  type: 'clock',
  category: 'Sources',
  label: 'Clock',
  description: 'Pulse generator at internal BPM or MIDI clock division. Internal BPM is the global Tempo (shared with Timeline + Classic LFOs).',
  inputs: [],
  outputs: [
    { name: 'out',  kind: 'trigger', range: [0, 1] },
    { name: 'phase', kind: 'control', range: [0, 1] },
  ],
  params: {
    source:   { kind: 'enum', options: ['internal', 'midi'], default: 'internal', help: 'Where the tempo comes from: internal follows the global Tempo, midi follows incoming MIDI clock.' },
    division: { kind: 'enum', options: [...ALL_DIVISIONS], default: '1/4', help: 'Note length between pulses, e.g. 1/4 pulses every beat and 1/1 once per bar.' },
    pulseMs:  { kind: 'number', min: 1, max: 200, step: 1, default: 16, help: 'How quickly each pulse fades back to 0, in milliseconds.' },
  },
  init: () => ({ phase: 0, lastPulse: 0 }),
  tick(ctx, state, _ins, params, outputs) {
    const source = params.source as string;
    const division = params.division as ClockDivision;
    let phase = 0;
    if (source === 'midi' && ctx.deps.midiClock) {
      // MIDI sync: read live phase from the global MIDI clock. No fallback
      // to internal BPM when the clock is silent — the node holds at its
      // last value (state.phase remains where it was).
      phase = ctx.deps.midiClock.divisionPhase(division);
      state.phase = phase;
    } else {
      // Internal sync: read shared `Settings.internalBpm` via NodeDeps so
      // a single global Tempo control drives Timeline, Classic, and Graph.
      const bpm = ctx.deps.bpm ?? 120;
      const beatsPerCycle = divisionToBeats(division);
      const hz = (bpm / 60) / Math.max(0.0001, beatsPerCycle);
      state.phase = (state.phase + hz * ctx.dt) % 1;
      if (state.phase < 0) state.phase += 1;
      phase = state.phase;
    }
    // Emit a short pulse (decaying gate) at the wrap.
    const pulseDecay = 1 / Math.max(0.001, +(params.pulseMs as number) / 1000);
    state.lastPulse = Math.max(0, state.lastPulse - ctx.dt * pulseDecay);
    if (phase < 0.05 && state.phase < 0.05) state.lastPulse = 1;
    outputs.out = state.lastPulse;
    outputs.phase = phase;
  },
});

// ---------- v10: Pattern Output ----------
//
// Reads an internal control signal published by the active Pattern
// Generator (Lissajous X / Y, Sine Bands wave, Oscilloscope mean /
// trigger / peak, etc.) and exposes it as a graph control signal.
//
// The bus id (`<patternKind>:<signalId>`, e.g. `'lissajous:x'`) is
// stored on the node as the `output` param. The list of available
// outputs is built lazily from the pattern registry so a new pattern
// shipping new signals shows up here automatically.

import { listPatternOutputs } from '../../../renderer/patterns/PatternRegistry';

const PATTERN_OUTPUT_OPTIONS = (() => {
  const ids = listPatternOutputs().map((e) => e.busId);
  // Always include the empty-string sentinel so a freshly created
  // node has a valid default before the user picks one.
  return ids.length > 0 ? ids : [''];
})();

/** The pattern signal's declared polarity (PatternOutputDef.range); an unknown or empty id reads 0. */
const PATTERN_OUTPUT_UNIPOLAR = new Map(listPatternOutputs().map((e) => [e.busId, e.signal.range === 'unipolar']));
function patternOutputRange(id: string): readonly [number, number] {
  const uni = PATTERN_OUTPUT_UNIPOLAR.get(id);
  return uni === undefined ? [0, 0] : uni ? [0, 1] : [-1, 1];
}

register<{}>({
  type: 'pattern-output',
  category: 'Sources',
  label: 'Pattern Output',
  description: 'Read an internal control signal from the active Pattern Generator (Lissajous X/Y, Sine Bands wave, Oscilloscope mean/trigger/peak, etc.).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control', range: (p) => patternOutputRange(String(p.output ?? '')) }],
  params: {
    /** Bus id `<patternKind>:<signalId>` — e.g. `'lissajous:x'`. */
    output: {
      kind: 'enum',
      options: PATTERN_OUTPUT_OPTIONS,
      default: PATTERN_OUTPUT_OPTIONS[0] ?? '',
      help: 'Which Pattern Generator signal to read, e.g. Lissajous X; reads 0 unless that pattern is active.',
    },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const bus = ctx.deps.patternBus;
    if (!bus) { outputs.out = 0; return; }
    const id = String(params.output ?? '');
    if (!id) { outputs.out = 0; return; }
    outputs.out = bus.get(id);
  },
});

// ---------- Sync (v22) ----------
//
// Simulated video-sync clock, framed honestly as EMULATION: a WebGL
// renderer has no real H/V sync to tap, so this node is locked to the
// render frame ("V") instead. `pulse` fires a 1-frame trigger every
// N frames; `phase` is the 0..1 scan position within the division
// period. True per-line H-sync (scanRate × frame rate, tens of kHz)
// cannot exist at the per-frame control rate — that's the audio-rate
// modulation design track (AUDIT item 1).
register<{ count: number }>({
  type: 'sync',
  category: 'Sources',
  label: 'Sync (V)',
  description: 'Frame-locked sync pulses — the emulated vertical-sync clock. Pulse fires every N frames; phase ramps 0..1 across the period. Feed pulse into Sample & Hold or the Sequencer to lock them to the raster.',
  inputs: [],
  outputs: [
    { name: 'pulse', kind: 'trigger', range: [0, 1] },
    { name: 'phase', kind: 'control', range: [0, 1] },
  ],
  params: {
    division: { kind: 'enum', options: ['1', '2', '4', '8', '16'], default: '1', help: 'Fire a pulse every N rendered frames (1 = every frame).' },
  },
  init: () => ({ count: 0 }),
  tick(_ctx, state, _ins, params, outputs) {
    const n = Math.max(1, Number.parseInt(String(params.division), 10) || 1);
    const inPeriod = state.count % n;
    outputs.pulse = inPeriod === 0 ? 1 : 0;
    outputs.phase = inPeriod / n;
    state.count = (state.count + 1) % 1_000_000;
  },
});

// Legacy `beatsForDivision` was removed in v8; nodes use `divisionToBeats`
// from `src/modulation/tempo.ts` (single source of truth).
