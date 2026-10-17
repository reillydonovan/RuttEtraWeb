/**
 * Logic / utility nodes — gate / trigger plumbing and a step sequencer.
 */

import { register } from '../registry';

// ---------- Trigger -> Gate ----------

interface TGState { remaining: number; lastTrigger: number; }

register<TGState>({
  type: 'trigger-to-gate',
  category: 'Logic',
  label: 'Trigger → Gate',
  description: 'Convert a one-frame pulse into a sustained gate of N ms.',
  inputs: [{ name: 'in', kind: 'trigger' }],
  outputs: [{ name: 'out', kind: 'gate', range: [0, 1] }],
  params: {
    lengthMs: { kind: 'number', min: 1, max: 5000, step: 1, default: 250, help: 'How long the gate stays open after each incoming pulse, in milliseconds.' },
  },
  init: () => ({ remaining: 0, lastTrigger: 0 }),
  tick(ctx, state, ins, params, outputs) {
    const t = ins.in ?? 0;
    if (t > 0.5 && state.lastTrigger <= 0.5) {
      state.remaining = +(params.lengthMs as number) / 1000;
    }
    state.lastTrigger = t;
    if (state.remaining > 0) {
      state.remaining -= ctx.dt;
      outputs.out = state.remaining > 0 ? 1 : 0;
    } else {
      outputs.out = 0;
    }
  },
});

// ---------- Gate -> Trigger ----------

interface GTState { lastGate: number; }

register<GTState>({
  type: 'gate-to-trigger',
  category: 'Logic',
  label: 'Gate → Trigger',
  description: "Emit a one-frame pulse on the gate's rising edge.",
  inputs: [{ name: 'in', kind: 'gate' }],
  outputs: [{ name: 'out', kind: 'trigger', range: [0, 1] }],
  params: {},
  init: () => ({ lastGate: 0 }),
  tick(_ctx, state, ins, _p, outputs) {
    const g = ins.in ?? 0;
    outputs.out = g > 0.5 && state.lastGate <= 0.5 ? 1 : 0;
    state.lastGate = g;
  },
});

// ---------- Clock divider ----------

interface CDState { count: number; lastClock: number; gate: number; }

register<CDState>({
  type: 'clock-divider',
  category: 'Logic',
  label: 'Clock ÷ N',
  description: 'Pass every N-th rising clock pulse through.',
  inputs: [{ name: 'clock', kind: 'trigger' }],
  outputs: [{ name: 'out', kind: 'trigger', range: [0, 1] }],
  params: {
    divisor: { kind: 'number', min: 1, max: 64, step: 1, default: 2, help: 'Let one pulse through for every N clock pulses in (2 = half speed).' },
  },
  init: () => ({ count: 0, lastClock: 0, gate: 0 }),
  tick(_ctx, state, ins, params, outputs) {
    const t = ins.clock ?? 0;
    if (t > 0.5 && state.lastClock <= 0.5) {
      state.count++;
      const div = Math.max(1, Math.round(+(params.divisor as number)));
      if (state.count >= div) {
        state.count = 0;
        outputs.out = 1;
      } else {
        outputs.out = 0;
      }
    } else {
      outputs.out = 0;
    }
    state.lastClock = t;
  },
});

// ---------- Sequencer ----------

interface SeqState { step: number; lastClock: number; lastReset: number; }

register<SeqState>({
  type: 'sequencer',
  category: 'Logic',
  label: 'Sequencer',
  description: 'Step sequencer — clock advances steps; output is the current step value.',
  inputs: [
    { name: 'clock', kind: 'trigger' },
    { name: 'reset', kind: 'trigger' },
  ],
  outputs: [
    // Step values are -1..+1 params; the output is one of them.
    { name: 'out',  kind: 'control', range: [-1, 1] },
    { name: 'gate', kind: 'gate', range: [0, 1] },
  ],
  params: {
    steps: { kind: 'number', min: 2, max: 16, step: 1, default: 8, help: 'How many steps play before the sequence loops back to step 1.' },
    s1:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 1 (-1 to +1).' },
    s2:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.25, help: 'Value output while the sequence is on step 2 (-1 to +1).' },
    s3:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.5, help: 'Value output while the sequence is on step 3 (-1 to +1).' },
    s4:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.75, help: 'Value output while the sequence is on step 4 (-1 to +1).' },
    s5:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 1, help: 'Value output while the sequence is on step 5 (-1 to +1).' },
    s6:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.75, help: 'Value output while the sequence is on step 6 (-1 to +1).' },
    s7:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.5, help: 'Value output while the sequence is on step 7 (-1 to +1).' },
    s8:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0.25, help: 'Value output while the sequence is on step 8 (-1 to +1).' },
    s9:    { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 9 (-1 to +1).' },
    s10:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 10 (-1 to +1).' },
    s11:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 11 (-1 to +1).' },
    s12:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 12 (-1 to +1).' },
    s13:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 13 (-1 to +1).' },
    s14:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 14 (-1 to +1).' },
    s15:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 15 (-1 to +1).' },
    s16:   { kind: 'number', min: -1, max: 1, step: 0.01, default: 0, help: 'Value output while the sequence is on step 16 (-1 to +1).' },
  },
  init: () => ({ step: 0, lastClock: 0, lastReset: 0 }),
  tick(_ctx, state, ins, params, outputs) {
    const stepCount = Math.max(1, Math.round(+(params.steps as number)));
    const r = ins.reset ?? 0;
    if (r > 0.5 && state.lastReset <= 0.5) state.step = 0;
    state.lastReset = r;

    const c = ins.clock ?? 0;
    let advanced = false;
    if (c > 0.5 && state.lastClock <= 0.5) {
      state.step = (state.step + 1) % stepCount;
      advanced = true;
    }
    state.lastClock = c;

    const key = `s${state.step + 1}`;
    outputs.out = +(params[key] as number);
    outputs.gate = advanced ? 1 : 0;
  },
});
