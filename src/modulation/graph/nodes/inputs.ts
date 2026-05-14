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

// ---------- v9: CV input (audio-interface / OSC-bridge) ----------

register<{}>({
  type: 'cv-input',
  category: 'Inputs',
  label: 'CV Input',
  description: 'External voltage control via DC-coupled audio interface, OSC bridge, or MIDI CC.',
  inputs: [],
  outputs: [
    { name: 'out', kind: 'control', label: 'Out (-1..1)' },
  ],
  params: {
    /**
     * Which routing the node reads from.
     *   audio    — DC-coupled audio interface channel (Route A)
     *   osc      — OSC bridge `/cv/<n>` (Route C)
     *   midi-cc  — pulled in for completeness; bound via MIDI Learn separately
     */
    route:    { kind: 'enum', options: ['audio', 'osc', 'midi-cc'], default: 'audio' },
    /** Channel/bridge/CC number (0-indexed for audio/osc, 0..127 for midi-cc). */
    channel:  { kind: 'number', min: 0, max: 127, step: 1, default: 0 },
    /** When the audio route is active, this overrides the channel's
     *  global polarity for THIS node only. Useful when the same physical
     *  CV is read by two patches that need different shapings. */
    bipolar:  { kind: 'boolean', default: true },
    /** When using the midi-cc route, MIDI channel 1..16 (0 = omni). */
    midiChannel: { kind: 'number', min: 0, max: 16, step: 1, default: 0 },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const route = String(params.route ?? 'audio');
    const ch = Math.max(0, Math.round(+(params.channel ?? 0) as number));
    const bipolar = (params.bipolar as boolean) ?? true;

    let v = 0;
    if (route === 'audio') {
      const cv = ctx.deps.cv;
      if (cv && cv.running) {
        v = cv.getNormalized(ch);
      }
    } else if (route === 'osc') {
      // The CV bridge emits `/cv/<n>` OSC messages; we read the matching
      // address. `n` is 1-indexed by convention in the bridge spec.
      const o = ctx.deps.osc;
      if (o && o.getByAddress) {
        v = o.getByAddress(`/cv/${ch + 1}`);
        if (bipolar) v = v * 2 - 1;
      }
    } else if (route === 'midi-cc') {
      const m = ctx.deps.midiMapping;
      if (m) {
        const mch = Math.round(+(params.midiChannel ?? 0) as number);
        const raw = m.getRawCC(mch || 1, ch);
        v = bipolar ? raw * 2 - 1 : raw;
      }
    }

    if (!Number.isFinite(v)) v = 0;
    if (v > 1) v = 1; else if (v < -1) v = -1;
    outputs.out = v;
  },
});

// ---------- v9: Gamepad / HID ----------

register<{}>({
  type: 'gamepad-axis',
  category: 'Inputs',
  label: 'Gamepad Axis',
  description: 'Axis of the connected gamepad / HID controller (-1..1, deadzone applied).',
  inputs: [],
  outputs: [{ name: 'out', kind: 'control' }],
  params: {
    axis: { kind: 'number', min: 0, max: 31, step: 1, default: 0 },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const g = ctx.deps.gamepad;
    if (!g) { outputs.out = 0; return; }
    outputs.out = g.getAxis(Math.max(0, Math.round(+(params.axis ?? 0) as number)));
  },
});

register<{}>({
  type: 'gamepad-button',
  category: 'Inputs',
  label: 'Gamepad Button',
  description: 'Button of the connected gamepad / HID controller (0..1).',
  inputs: [],
  outputs: [
    { name: 'out',  kind: 'control' },
    { name: 'gate', kind: 'gate' },
  ],
  params: {
    button: { kind: 'number', min: 0, max: 31, step: 1, default: 0 },
    bipolar: { kind: 'boolean', default: false },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const g = ctx.deps.gamepad;
    if (!g) { outputs.out = 0; outputs.gate = 0; return; }
    const v = g.getButton(Math.max(0, Math.round(+(params.button ?? 0) as number)));
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
    outputs.gate = v > 0.5 ? 1 : 0;
  },
});
