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
  outputs: [{ name: 'out', kind: 'control' }],
  params: { level: { kind: 'number', min: 0, max: 1, step: 0.001, default: 1 } },
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
  outputs: [{ name: 'out', kind: 'control' }],
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: { bias: { kind: 'number', min: -2, max: 2, step: 0.001, default: 0 } },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: { factor: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1 } },
  init: () => ({}),
  tick(_ctx, _s, ins, params, outputs) {
    outputs.out = (ins.in ?? 0) * +(params.factor as number);
  },
});

// ---------- Range ----------

register<{}>({
  type: 'range',
  category: 'Processors',
  label: 'Range',
  description: 'Remap input range [a,b] to output range [c,d] with optional clamp.',
  inputs: [{ name: 'in', kind: 'control' }],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    inMin:  { kind: 'number', min: -8, max: 8, step: 0.01, default: 0 },
    inMax:  { kind: 'number', min: -8, max: 8, step: 0.01, default: 1 },
    outMin: { kind: 'number', min: -8, max: 8, step: 0.01, default: 0 },
    outMax: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1 },
    clamp:  { kind: 'boolean', default: true },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    gain1: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1 },
    gain2: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1 },
    gain3: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1 },
    gain4: { kind: 'number', min: 0, max: 2, step: 0.01, default: 1 },
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
  outputs: [{ name: 'out', kind: 'control' }],
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    bias: { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
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
  outputs: [{ name: 'out', kind: 'control' }],
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
  outputs: [{ name: 'out', kind: 'control' }],
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
  outputs: [{ name: 'out', kind: 'gate' }],
  params: {
    bipolar: { kind: 'boolean', default: false },
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
  outputs: [{ name: 'out', kind: 'control' }],
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    riseMs: { kind: 'number', min: 0, max: 5000, step: 1, default: 100 },
    fallMs: { kind: 'number', min: 0, max: 5000, step: 1, default: 100 },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    steps: { kind: 'number', min: 2, max: 64, step: 1, default: 8 },
    inMin: { kind: 'number', min: -8, max: 8, step: 0.01, default: -1 },
    inMax: { kind: 'number', min: -8, max: 8, step: 0.01, default: 1 },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    shape: { kind: 'enum', options: ['linear', 'exp', 'log', 'sCurve'], default: 'linear' },
    amount: { kind: 'number', min: 0, max: 4, step: 0.01, default: 1 },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    frames: { kind: 'number', min: 1, max: 240, step: 1, default: 1 },
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
  outputs: [{ name: 'out', kind: 'control' }],
  params: {},
  init: () => ({ value: 0 }),
  tick(_ctx, state, ins, _p, outputs) {
    if ((ins.gate ?? 0) > 0.5) state.value = ins.in ?? 0;
    outputs.out = state.value;
  },
});
