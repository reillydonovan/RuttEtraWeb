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
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
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
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
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
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
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
  outputs: [{ name: 'out', kind: 'control', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) }],
  params: {
    channel: { kind: 'number', min: 1,  max: 16,  step: 1, default: 1, help: 'MIDI channel to listen on (1-16).' },
    cc:      { kind: 'number', min: 0,  max: 127, step: 1, default: 1, help: 'Controller number to follow (0-127); 1 is usually the mod wheel.' },
    bipolar: { kind: 'boolean', default: false, help: 'ON maps the controller to -1..+1 (a centred knob reads 0); OFF keeps it 0 to 1.' },
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
    { name: 'pitch',    kind: 'control', range: [0, 1] },
    { name: 'velocity', kind: 'control', range: [0, 1] },
  ],
  params: {
    channel: { kind: 'number', min: 1, max: 16, step: 1, default: 1, help: 'MIDI channel to listen on (1-16) for the last note played.' },
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
  // OSC values pass through unclamped; this is the span for the usual 0..1 message.
  outputs: [{ name: 'out', kind: 'control', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) }],
  params: {
    address: { kind: 'enum', options: ['/most-recent'], default: '/most-recent', help: 'Which OSC address to read; /most-recent follows whatever message arrived last.' },
    bipolar: { kind: 'boolean', default: false, help: 'ON maps an incoming 0..1 value to -1..+1; OFF passes it through.' },
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
    // Clamped to ±1; the OSC and MIDI CC routes with Bipolar off read 0..1. The audio route
    // follows the channel's own polarity, so it may span the full ±1.
    { name: 'out', kind: 'control', label: 'Out (-1..1)', range: (p) => ((p.route ?? 'audio') !== 'audio' && p.bipolar === false ? [0, 1] : [-1, 1]) },
  ],
  params: {
    /**
     * Which routing the node reads from.
     *   audio    — DC-coupled audio interface channel (Route A)
     *   osc      — OSC bridge `/cv/<n>` (Route C)
     *   midi-cc  — pulled in for completeness; bound via MIDI Learn separately
     */
    route:    { kind: 'enum', options: ['audio', 'osc', 'midi-cc'], default: 'audio', help: 'Where the voltage arrives: audio is a DC-coupled interface input, osc the CV bridge, midi-cc a MIDI knob.' },
    /** Channel/bridge/CC number (0-indexed for audio/osc, 0..127 for midi-cc). */
    channel:  { kind: 'number', min: 0, max: 127, step: 1, default: 0, help: 'Input to read: interface or bridge channel counting from 0, or the CC number on the midi-cc route.' },
    /** When the audio route is active, this overrides the channel's
     *  global polarity for THIS node only. Useful when the same physical
     *  CV is read by two patches that need different shapings. */
    bipolar:  { kind: 'boolean', default: true, help: 'OSC and MIDI CC routes: ON maps 0..1 to -1..+1. The audio route uses the channel\'s own polarity.' },
    /** When using the midi-cc route, MIDI channel 1..16 (0 = omni). */
    midiChannel: { kind: 'number', min: 0, max: 16, step: 1, default: 0, help: 'MIDI channel for the midi-cc route (1-16); 0 currently reads channel 1.' },
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
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    axis: { kind: 'number', min: 0, max: 31, step: 1, default: 0, help: 'Which stick axis to read, counting from 0 (on most pads 0 and 1 are the left stick).' },
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
    { name: 'out',  kind: 'control', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) },
    { name: 'gate', kind: 'gate', range: [0, 1] },
  ],
  params: {
    button: { kind: 'number', min: 0, max: 31, step: 1, default: 0, help: 'Which button to read, counting from 0; analog triggers give values in between.' },
    bipolar: { kind: 'boolean', default: false, help: 'ON makes the main output -1 when released and +1 when pressed; the gate output is unaffected.' },
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

// ---------- Param Out (Patch Bay per-param OUT jacks) ----------
//
// A synth parameter's LIVE value (base + every modulation layer) as a
// control signal — the software equivalent of the RE-4's per-param
// output jack. Reads via the engine-wired `deps.paramLive` hook, which
// sees the PREVIOUS frame's contributions (this frame's bindings apply
// after nodes tick), so param→param patches get a clean one-frame
// delay — the same semantics as a feedback loop's cycle edges. The key
// list mirrors `TARGETS` (the modulation-target registry) so this node
// can read exactly what the rest of the system can write.

import { TARGETS } from '../../../ui/targets';

const PARAM_OUT_KEYS = TARGETS.map((t) => String(t.v));

register<{}>({
  type: 'param-out',
  category: 'Inputs',
  label: 'Param Out',
  description: 'A synth parameter’s live value (base + all modulation, one frame behind) as a control signal — what the Patch Bay’s per-param OUT jacks create. Raw parameter units; add a Scale/Range processor to normalize.',
  inputs: [],
  // Raw parameter units: the true span is that param's own range, not knowable statically.
  outputs: [{ name: 'out', kind: 'control', range: [-1, 1] }],
  params: {
    key: { kind: 'enum', options: PARAM_OUT_KEYS, default: 'zPush', help: 'Which synth parameter to read; outputs its live value, modulation included.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    outputs.out = ctx.deps.paramLive?.(String(params.key ?? '')) ?? 0;
  },
});
