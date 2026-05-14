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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    shape:    { kind: 'enum', options: ['sine', 'triangle', 'saw', 'square', 'pulse'], default: 'sine' },
    rate:     { kind: 'number', min: 0.01, max: 30,  step: 0.01, default: 1 },
    phase:    { kind: 'number', min: 0,    max: 1,   step: 0.001, default: 0 },
    duty:     { kind: 'number', min: 0.05, max: 0.95, step: 0.01, default: 0.5 },
    bipolar:  { kind: 'boolean', default: true },
  },
  init: () => ({ phase: 0 }),
  tick(ctx, state, _ins, params, outputs) {
    const rate = +(params.rate as number);
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    mode:     { kind: 'enum', options: ['up', 'down', 'triangle', 'one-shot'], default: 'up' },
    timeSec:  { kind: 'number', min: 0.05, max: 600, step: 0.05, default: 4 },
    bipolar:  { kind: 'boolean', default: true },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    kind:    { kind: 'enum', options: ['white', 'pink', 'sample-and-hold'], default: 'white' },
    bipolar: { kind: 'boolean', default: true },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    value: { kind: 'number', min: -2, max: 2, step: 0.001, default: 0 },
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
    { name: 'out',  kind: 'trigger' },
    { name: 'phase', kind: 'control' },
  ],
  params: {
    source:   { kind: 'enum', options: ['internal', 'midi'], default: 'internal' },
    division: { kind: 'enum', options: [...ALL_DIVISIONS], default: '1/4' },
    pulseMs:  { kind: 'number', min: 1, max: 200, step: 1, default: 16 },
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

// Legacy `beatsForDivision` was removed in v8; nodes use `divisionToBeats`
// from `src/modulation/tempo.ts` (single source of truth).
