/**
 * Processor nodes — modify signals.
 *
 * Most are stateless and trivially testable. The few that hold state
 * (slew, sample-and-hold, track-and-hold, delay) keep it small and
 * deterministic so the engine stays fully reproducible from a snapshot.
 */

import { register } from '../registry';
import { slewToward } from '../../outputStage';

// ---------- Attenuator ----------

register<{}>({
  type: 'attenuator',
  category: 'Processors',
  label: 'Attenuator',
  description: 'Multiply input by a 0..1 level (basic volume).',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const l = Math.abs(+(p.level ?? 1)); return [-l, l]; } }],
  params: { level: { kind: 'number', min: 0, max: 1, step: 0.001, default: 1, help: 'How much of the input passes through: 1 is all of it, 0 is silence.' } },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    outputs.out = (ins.in ?? 0) * +(params.level as number);
  },
});

// ---------- Inverter ----------

register<{}>({
  type: 'inverter',
  category: 'Processors',
  label: 'Inverter',
  description: 'Negate input.',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({}),
  tick(_ctx, _s, ins, _params, outputs) {
    outputs.out = -(ins.in ?? 0);
  },
});

// ---------- Offset ----------

register<{}>({
  type: 'offset',
  category: 'Processors',
  label: 'Offset',
  description: 'Add a DC bias to the input.',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const b = +(p.bias ?? 0); return [-1 + b, 1 + b]; } }],
  params: { bias: { kind: 'number', min: -2, max: 2, step: 0.001, default: 0, help: 'Amount added to the input, shifting the whole signal up (positive) or down (negative).' } },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    outputs.out = (ins.in ?? 0) + +(params.bias as number);
  },
});

// ---------- Scale ----------

register<{}>({
  type: 'scale',
  category: 'Processors',
  label: 'Scale',
  description: 'Multiply by a constant (can be >1 or negative).',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const g = Math.abs(+(p.factor ?? 1)); return [-g, g]; } }],
  params: { factor: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1, help: 'Multiplier for the input: above 1 boosts, below 1 shrinks, negative flips it upside down.' } },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    outputs.out = (ins.in ?? 0) * +(params.factor as number);
  },
});

// ---------- Range ----------

/** Range node's output span: [outMin, outMax] when clamped, else what a ±1 input maps to. */
function rangeNodeSpan(p: Record<string, number | string | boolean>): readonly [number, number] {
  const inMin = +(p.inMin ?? 0), inMax = +(p.inMax ?? 1), outMin = +(p.outMin ?? 0), outMax = +(p.outMax ?? 1);
  const map = (x: number): number => {
    let t = inMax === inMin ? 0 : (x - inMin) / (inMax - inMin);
    if (p.clamp !== false) t = Math.min(1, Math.max(0, t));
    return outMin + (outMax - outMin) * t;
  };
  const a = map(-1), b = map(1);
  return p.clamp !== false ? [Math.min(outMin, outMax), Math.max(outMin, outMax)] : [Math.min(a, b), Math.max(a, b)];
}


register<{}>({
  type: 'range',
  category: 'Processors',
  label: 'Range',
  description: 'Remap input range [a,b] to output range [c,d] with optional clamp.',
  inputs: [{ name: 'in', kind: 'control' }],
  // exact when clamped; otherwise for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: rangeNodeSpan }],
  params: {
    inMin:  { kind: 'number', min: -8, max: 8, step: 0.01, default: 0, help: 'Input value that maps to Out Min.' },
    inMax:  { kind: 'number', min: -8, max: 8, step: 0.01, default: 1, help: 'Input value that maps to Out Max.' },
    outMin: { kind: 'number', min: -8, max: 8, step: 0.01, default: 0, help: 'Output value when the input sits at In Min.' },
    outMax: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1, help: 'Output value when the input sits at In Max.' },
    clamp:  { kind: 'boolean', default: true, help: 'ON keeps the output between Out Min and Out Max even when the input strays outside its range.' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    const x = ins.in ?? 0;
    const inMin = +(params.inMin as number);
    const inMax = +(params.inMax as number);
    const outMin = +(params.outMin as number);
    const outMax = +(params.outMax as number);
    let t = inMax === inMin ? 0 : (x - inMin) / (inMax - inMin);
    if (params.clamp as boolean) {
      if (t < 0) t = 0;
      if (t > 1) t = 1;
    }
    outputs.out = outMin + (outMax - outMin) * t;
  },
});

// ---------- Mixer ----------

register<{}>({
  type: 'mixer',
  category: 'Processors',
  label: 'Mixer',
  description: 'Sum up to 4 input signals with per-channel gain.',
  inputs: [
    { name: 'in1', kind: 'control' },
    { name: 'in2', kind: 'control' },
    { name: 'in3', kind: 'control' },
    { name: 'in4', kind: 'control' },
  ],
  // for ±1 inputs
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const g = [1, 2, 3, 4].reduce((s, i) => s + Math.abs(+(p[`gain${i}`] ?? 1)), 0); return [-g, g]; } }],
  params: {
    gain1: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1, help: 'Level of input 1 in the mix (0 = off, 1 = unchanged, 2 = doubled).' },
    gain2: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1, help: 'Level of input 2 in the mix (0 = off, 1 = unchanged, 2 = doubled).' },
    gain3: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1, help: 'Level of input 3 in the mix (0 = off, 1 = unchanged, 2 = doubled).' },
    gain4: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1, help: 'Level of input 4 in the mix (0 = off, 1 = unchanged, 2 = doubled).' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    outputs.out =
      (ins.in1 ?? 0) * +(params.gain1 as number) +
      (ins.in2 ?? 0) * +(params.gain2 as number) +
      (ins.in3 ?? 0) * +(params.gain3 as number) +
      (ins.in4 ?? 0) * +(params.gain4 as number);
  },
});

// ---------- Multiplier (ring mod) ----------

register<{}>({
  type: 'multiplier',
  category: 'Processors',
  label: 'Multiplier',
  description: 'Ring modulator — output is A times B.',
  inputs: [
    { name: 'a', kind: 'control' },
    { name: 'b', kind: 'control' },
  ],
  // for ±1 inputs
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({}),
  tick(_ctx, _s, ins, _p, outputs) {
    outputs.out = (ins.a ?? 0) * (ins.b ?? 0);
  },
});

// ---------- Crossfade ----------

register<{}>({
  type: 'crossfade',
  category: 'Processors',
  label: 'Crossfade',
  description: 'Blend A and B by mix input X (0..1).',
  inputs: [
    { name: 'a', kind: 'control' },
    { name: 'b', kind: 'control' },
    { name: 'x', kind: 'control' },
  ],
  // for ±1 inputs
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    bias: { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5, help: 'Meant as the blend when X is unpatched (0 = A, 1 = B). Currently has no effect: an unpatched X reads 0, so patch X.' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    const a = ins.a ?? 0;
    const b = ins.b ?? 0;
    const x = ins.x ?? +(params.bias as number);
    const t = x < 0 ? 0 : x > 1 ? 1 : x;
    outputs.out = a * (1 - t) + b * t;
  },
});

// ---------- Min / Max ----------

register<{}>({
  type: 'min',
  category: 'Processors',
  label: 'Min',
  description: 'Output the minimum of the connected inputs.',
  inputs: [
    { name: 'in1', kind: 'control' },
    { name: 'in2', kind: 'control' },
    { name: 'in3', kind: 'control' },
    { name: 'in4', kind: 'control' },
  ],
  // for ±1 inputs
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({}),
  tick(_ctx, _s, ins, _p, outputs) {
    let v = Infinity;
    let any = false;
    for (const k of ['in1', 'in2', 'in3', 'in4']) {
      if (ins[k] !== undefined) { v = Math.min(v, ins[k]); any = true; }
    }
    outputs.out = any ? v : 0;
  },
});

register<{}>({
  type: 'max',
  category: 'Processors',
  label: 'Max',
  description: 'Output the maximum of the connected inputs.',
  inputs: [
    { name: 'in1', kind: 'control' },
    { name: 'in2', kind: 'control' },
    { name: 'in3', kind: 'control' },
    { name: 'in4', kind: 'control' },
  ],
  // for ±1 inputs
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({}),
  tick(_ctx, _s, ins, _p, outputs) {
    let v = -Infinity;
    let any = false;
    for (const k of ['in1', 'in2', 'in3', 'in4']) {
      if (ins[k] !== undefined) { v = Math.max(v, ins[k]); any = true; }
    }
    outputs.out = any ? v : 0;
  },
});

// ---------- Comparator ----------

register<{}>({
  type: 'comparator',
  category: 'Processors',
  label: 'Comparator',
  description: 'Output 1 when A > B, else 0 (or -1 in bipolar mode).',
  inputs: [
    { name: 'a', kind: 'control' },
    { name: 'b', kind: 'control' },
  ],
  outputs: [{ name: 'out', kind: 'gate', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) }],
  params: {
    bipolar: { kind: 'boolean', default: false, help: 'ON outputs -1 instead of 0 when A is not greater than B.' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    const hi = (ins.a ?? 0) > (ins.b ?? 0);
    outputs.out = hi ? 1 : (params.bipolar as boolean) ? -1 : 0;
  },
});

// ---------- Sample-and-Hold ----------

interface SHState { value: number; lastTrigger: number; }

register<SHState>({
  type: 'sample-and-hold',
  category: 'Processors',
  label: 'Sample & Hold',
  description: 'Capture the value input on each rising trigger.',
  inputs: [
    { name: 'in',      kind: 'control' },
    { name: 'trigger', kind: 'trigger' },
  ],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({ value: 0, lastTrigger: 0 }),
  tick(_ctx, state, ins, _p, outputs) {
    const t = ins.trigger ?? 0;
    if (t > 0.5 && state.lastTrigger <= 0.5) state.value = ins.in ?? 0;
    state.lastTrigger = t;
    outputs.out = state.value;
  },
});

// ---------- Slew ----------

interface SlewState { value: number; }

register<SlewState>({
  type: 'slew',
  category: 'Processors',
  label: 'Slew',
  description: 'Rise/fall slew limiter — smooth jagged signals (audio, motion).',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    riseMs: { kind: 'number', min: 0, max: 5000, step: 1, default: 100, help: 'How slowly the output follows the input upward, in milliseconds (0 = instantly).' },
    fallMs: { kind: 'number', min: 0, max: 5000, step: 1, default: 100, help: 'How slowly the output follows the input downward, in milliseconds (0 = instantly).' },
  },
  init: () => ({ value: 0 }),
  tick(ctx, state, ins, params, outputs) {
    const target = ins.in ?? 0;
    // Shared implementation with the Classic per-slot slew (v18) —
    // one concept, one source (modulation/outputStage.ts).
    state.value = slewToward(
      state.value, target, ctx.dt,
      +(params.riseMs as number), +(params.fallMs as number),
    );
    outputs.out = state.value;
  },
});

// ---------- Quantize ----------

register<{}>({
  type: 'quantize',
  category: 'Processors',
  label: 'Quantize',
  description: 'Snap input to N evenly-spaced steps in its range.',
  inputs: [{ name: 'in', kind: 'control' }],
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const a = +(p.inMin ?? -1), b = +(p.inMax ?? 1); return [Math.min(a, b), Math.max(a, b)]; } }],
  params: {
    steps: { kind: 'number', min: 2, max: 64, step: 1, default: 8, help: 'Number of fixed levels the input snaps to; fewer steps gives a chunkier staircase.' },
    inMin: { kind: 'number', min: -8, max: 8, step: 0.01, default: -1, help: 'Bottom of the range to divide into steps; lower inputs snap to this value.' },
    inMax: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1, help: 'Top of the range to divide into steps; higher inputs snap to this value.' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    const x = ins.in ?? 0;
    const inMin = +(params.inMin as number);
    const inMax = +(params.inMax as number);
    const steps = Math.max(2, Math.round(+(params.steps as number)));
    if (inMax === inMin) { outputs.out = inMin; return; }
    const t = (x - inMin) / (inMax - inMin);
    const tClamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const stepped = Math.floor(tClamped * steps);
    const idx = stepped >= steps ? steps - 1 : stepped;
    outputs.out = inMin + (idx / (steps - 1)) * (inMax - inMin);
  },
});

// ---------- Curve ----------

register<{}>({
  type: 'curve',
  category: 'Processors',
  label: 'Curve',
  description: 'Apply easing curve (linear / exp / log / S) to the input.',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    shape: { kind: 'enum', options: ['linear', 'exp', 'log', 'sCurve'], default: 'linear', help: 'Response shape: linear leaves it alone, exp starts slow then rises fast, log rises fast then eases, sCurve eases both ends.' },
    amount: { kind: 'number', min: 0, max: 4, step: 0.01, default: 1, help: 'How strongly the exp and log shapes bend the signal; no effect on linear or sCurve.' },
  },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    const v = ins.in ?? 0;
    const sign = v < 0 ? -1 : 1;
    const mag = Math.abs(v);
    const k = +(params.amount as number);
    let shaped = mag;
    switch (params.shape as string) {
      case 'exp':    shaped = Math.pow(mag, 1 + k); break;
      case 'log':    shaped = Math.pow(mag, 1 / (1 + k)); break;
      case 'sCurve': {
        const t = mag > 1 ? 1 : mag < 0 ? 0 : mag;
        shaped = t * t * (3 - 2 * t);
        break;
      }
      default:       shaped = mag;
    }
    outputs.out = sign * shaped;
  },
});

// ---------- Delay ----------

interface DelayState { ring: Float32Array; head: number; }

register<DelayState>({
  type: 'delay',
  category: 'Processors',
  label: 'Delay',
  description: 'Delay input by N frames — enables short feedback loops.',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    frames: { kind: 'number', min: 1, max: 240, step: 1, default: 1, help: 'How many frames late the output repeats the input (60 is about one second at 60 fps).' },
  },
  init: (params) => {
    const n = Math.max(1, Math.round(+(params.frames as number)));
    return { ring: new Float32Array(n), head: 0 };
  },
  tick(_ctx, state, ins, params, outputs) {
    const frames = Math.max(1, Math.round(+(params.frames as number)));
    if (state.ring.length !== frames) {
      const next = new Float32Array(frames);
      // Best-effort copy of the most recent values.
      const m = Math.min(frames, state.ring.length);
      for (let i = 0; i < m; i++) next[i] = state.ring[(state.head + i) % state.ring.length];
      state.ring = next;
      state.head = 0;
    }
    outputs.out = state.ring[state.head];
    state.ring[state.head] = ins.in ?? 0;
    state.head = (state.head + 1) % state.ring.length;
  },
});

// ---------- Track-and-Hold ----------

interface THState { value: number; }

register<THState>({
  type: 'track-and-hold',
  category: 'Processors',
  label: 'Track & Hold',
  description: 'Track input while gate is high, hold last value when gate goes low.',
  inputs: [
    { name: 'in',   kind: 'control' },
    { name: 'gate', kind: 'gate' },
  ],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({ value: 0 }),
  tick(_ctx, state, ins, _p, outputs) {
    if ((ins.gate ?? 0) > 0.5) state.value = ins.in ?? 0;
    outputs.out = state.value;
  },
});

// ---------- Envelope (ADSR, v22) ----------
//
// The true envelope generator the catalog lacked (AUDIT item 6):
// gate-in, ADSR out. Attack/decay/release are exponential approaches
// (analog-RC feel); attack aims 30% past 1.0 and clamps so it actually
// completes. Rising gate edge retriggers the attack FROM THE CURRENT
// VALUE (no click); falling edge enters release from wherever it is.

type EnvPhase = 'idle' | 'attack' | 'decay' | 'release';
interface EnvState { phase: EnvPhase; value: number; gateWasHigh: boolean }

register<EnvState>({
  type: 'envelope',
  category: 'Processors',
  label: 'Envelope (ADSR)',
  description: 'Gate-triggered attack/decay/sustain/release envelope — patch a beat, comparator, or Sync pulse into gate and shape any parameter like a VCA.',
  inputs: [{ name: 'gate', kind: 'gate' }],
  outputs: [{ name: 'out', kind: 'control', range: [0, 1] }],
  params: {
    attackMs:  { kind: 'number', min: 1, max: 10000, step: 1, default: 50, help: 'Time to rise to full level when the gate opens, in milliseconds.' },
    decayMs:   { kind: 'number', min: 1, max: 10000, step: 1, default: 200, help: 'Time to fall from full level to the Sustain level, in milliseconds.' },
    sustain:   { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.6, help: 'Level held while the gate stays open, from 0 to 1.' },
    releaseMs: { kind: 'number', min: 1, max: 10000, step: 1, default: 400, help: 'Time to fade back to 0 after the gate closes, in milliseconds.' },
  },
  init: () => ({ phase: 'idle' as EnvPhase, value: 0, gateWasHigh: false }),
  tick(ctx, state, ins, params, outputs) {
    const gateHigh = (ins.gate ?? 0) > 0.5;
    if (gateHigh && !state.gateWasHigh) state.phase = 'attack';
    if (!gateHigh && state.gateWasHigh && state.phase !== 'idle') state.phase = 'release';
    state.gateWasHigh = gateHigh;

    const approach = (target: number, ms: number): void => {
      const tau = Math.max(0.001, ms / 1000);
      state.value += (target - state.value) * (1 - Math.exp(-ctx.dt / tau));
    };
    const sustain = +(params.sustain as number);

    switch (state.phase) {
      case 'attack':
        // Aim 30% past full scale so the exponential actually reaches 1.
        approach(1.3, +(params.attackMs as number));
        if (state.value >= 1) { state.value = 1; state.phase = 'decay'; }
        break;
      case 'decay':
        approach(sustain, +(params.decayMs as number));
        // Sustain is a hold, not a terminal — stay in decay approaching it.
        break;
      case 'release':
        approach(0, +(params.releaseMs as number));
        if (state.value <= 0.0005) { state.value = 0; state.phase = 'idle'; }
        break;
      case 'idle':
        state.value = 0;
        break;
    }
    outputs.out = state.value;
  },
});

// ---------- Filter (control-rate SVF, v22) ----------
//
// Chamberlin state-variable filter running at the graph's control rate.
// Cutoff tops out at 12 Hz — safely below the ~30 Hz control-rate
// Nyquist so the SVF stays stable at 60 fps. Resonance rings the way a
// modular filter does when you wobble a signal through it.

interface SvfState { low: number; band: number }

register<SvfState>({
  type: 'filter',
  category: 'Processors',
  label: 'Filter (LP/HP/BP)',
  description: 'Control-rate resonant filter (state-variable). Lowpass smooths, highpass isolates wiggle, bandpass rings around the cutoff — resonance adds overshoot like an analog filter.',
  inputs: [{ name: 'in', kind: 'control' }],
  // approx. for a ±1 input: resonance peaks near 1/(1 - resonance)
  outputs: [{ name: 'out', kind: 'control', range: (p) => { const g = 1 / Math.max(0.05, 1 - +(p.resonance ?? 0)); return [-g, g]; } }],
  params: {
    type:      { kind: 'enum', options: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass', help: 'Lowpass smooths out fast wiggles, highpass keeps only the wiggles, bandpass keeps motion near the cutoff.' },
    cutoffHz:  { kind: 'number', min: 0.01, max: 12, step: 0.01, default: 2, help: 'Frequency where the filter starts to act, in cycles per second (Hz).' },
    resonance: { kind: 'number', min: 0, max: 0.95, step: 0.01, default: 0, help: 'Emphasis at the cutoff: higher values overshoot and ring like an analog filter.' },
  },
  init: () => ({ low: 0, band: 0 }),
  tick(ctx, state, ins, params, outputs) {
    const x = ins.in ?? 0;
    const fc = +(params.cutoffHz as number);
    // Chamberlin coefficients; f clamped for stability at large dt.
    const f = Math.min(1.2, 2 * Math.sin(Math.PI * fc * ctx.dt));
    const q = 1 - +(params.resonance as number); // damping
    state.low += f * state.band;
    const high = x - state.low - q * state.band;
    state.band += f * high;
    const type = String(params.type);
    outputs.out = type === 'highpass' ? high : type === 'bandpass' ? state.band : state.low;
  },
});

// ---------- Scope (passthrough oscilloscope) ----------
//
// Signal-transparent: `out` is exactly `in`, so a scope can be spliced
// into any cable run without changing the sound of the patch — the
// point is the VISUAL. The Patch Bay draws a live trace on the scope's
// module (sampling the engine via `probe()` each frame, the same
// mechanism as the graph editor's Probe overlay); in the graph editor
// use Probe on its `out` port. Chosen over per-LFO waveform icons
// because it shows the ACTUAL signal — post-mix, post-filter, mid-
// feedback — for anything you patch through it, not an idealized
// picture of one node type.

register<{}>({
  type: 'scope',
  category: 'Processors',
  label: 'Scope',
  description: 'Passthrough oscilloscope: out = in, unchanged. Splice into any cable to SEE the signal — the Patch Bay renders a live trace on the module.',
  inputs: [{ name: 'in', kind: 'control' }],
  // for a ±1 input
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {},
  init: () => ({}),
  tick(_ctx, _s, ins, _p, outputs) {
    outputs.out = ins.in ?? 0;
  },
});
