/**
 * Input nodes — re-expose the existing joystick / MIDI / OSC streams as
 * graph sources. Nothing here owns the input; the engine just reads
 * whatever the I/O subsystems already publish.
 */

import { register } from '../registry';

// ---------- Joystick ----------

register<{}>({
  type: 'joystick-x',
  category: 'Inputs',
  label: 'Joystick X',
  description: 'Joystick / XY-pad horizontal axis (-1..+1).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {},
  init: () => ({}),
  tick(ctx, _s, _i, _p, outputs) { outputs.out = ctx.joystick.x; },
});

register<{}>({
  type: 'joystick-y',
  category: 'Inputs',
  label: 'Joystick Y',
  description: 'Joystick / XY-pad vertical axis (-1..+1).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {},
  init: () => ({}),
  tick(ctx, _s, _i, _p, outputs) { outputs.out = ctx.joystick.y; },
});

register<{}>({
  type: 'joystick-z',
  category: 'Inputs',
  label: 'Joystick Z',
  description: 'Joystick Z (mouse wheel / pad scroll) axis (-1..+1).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {},
  init: () => ({}),
  tick(ctx, _s, _i, _p, outputs) { outputs.out = ctx.joystick.z; },
});

// ---------- MIDI CC ----------

register<{}>({
  type: 'midi-cc',
  category: 'Inputs',
  label: 'MIDI CC',
  description: 'Last value received on the chosen MIDI CC (channel + number).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    channel: { kind: 'number', min: 1,  max: 16,  step: 1, default: 1 },
    cc:      { kind: 'number', min: 0,  max: 127, step: 1, default: 1 },
    bipolar: { kind: 'boolean', default: false },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const m = ctx.deps.midiMapping;
    if (!m) { outputs.out = 0; return; }
    const ch = Math.round(+(params.channel as number));
    const cc = Math.round(+(params.cc as number));
    const v = m.getRawCC(ch, cc); // 0..1
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- MIDI Note ----------

register<{}>({
  type: 'midi-note',
  category: 'Inputs',
  label: 'MIDI Note',
  description: 'Last note pitch + velocity from the chosen MIDI channel.',
  inputs: [],
  outputs: [
    { name: 'pitch',    kind: 'control' },
    { name: 'velocity', kind: 'control' },
  ],
  params: {
    channel: { kind: 'number', min: 1, max: 16, step: 1, default: 1 },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const m = ctx.deps.midiMapping;
    if (!m) { outputs.pitch = 0; outputs.velocity = 0; return; }
    const ch = Math.round(+(params.channel as number));
    const p = m.getPoly(ch);
    outputs.pitch = p.lastNote == null ? 0 : p.lastNote / 127;
    outputs.velocity = (p.lastVelocity ?? 0) / 127;
  },
});

// ---------- OSC ----------

register<{}>({
  type: 'osc-in',
  category: 'Inputs',
  label: 'OSC In',
  description: 'Last value received on a bound OSC address.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    address: { kind: 'enum', options: ['/most-recent'], default: '/most-recent' },
    bipolar: { kind: 'boolean', default: false },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const o = ctx.deps.osc;
    if (!o) { outputs.out = 0; return; }
    const addr = String(params.address ?? '/most-recent');
    const v = addr === '/most-recent' || !o.getByAddress
      ? o.getMostRecent()
      : o.getByAddress(addr);
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});
