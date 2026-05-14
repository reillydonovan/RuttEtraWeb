/**
 * Output / sink nodes — opposite of the input nodes. These nodes have
 * an input port for a control signal and no output ports; their job
 * is to deliver the input to an external subsystem (CV-output, future
 * MIDI-out node, etc.) once per frame.
 *
 * The visual editor renders cv-output nodes with a distinct icon and
 * amber tint so users can tell at a glance that this node is sending
 * voltages OUT to hardware, not modulating an internal Settings param.
 *
 * Type-specific shaping (gate threshold, trigger pulse width, clock
 * division, pitch 1V/oct math) lives in the channel's CVOutputChannel
 * config in the I/O panel — NOT in node params. That way the same
 * `cv-output` node placement can be re-typed without rewiring the
 * graph: just change the type in the I/O panel and the same input
 * signal becomes a gate, trigger, clock, or pitch CV.
 */

import { register } from '../registry';

register<{}>({
  type: 'cv-output',
  category: 'Inputs', // grouped under Inputs in palette so users find it next to cv-input
  label: 'CV Output',
  description: 'Sends the input signal as a voltage on the configured CV output channel. Type, range, and calibration live in the I/O panel.',
  inputs: [
    { name: 'signal', kind: 'control', label: 'Signal' },
  ],
  outputs: [],
  params: {
    /** 0-based output channel index on the configured DC-coupled
     *  interface. Cosmetic mirror of the I/O panel — changing here
     *  just routes this node to a different CVOutputChannel. */
    channel: { kind: 'number', min: 0, max: 31, step: 1, default: 0 },
  },
  init: () => ({}),
  tick(ctx, _s, inputs, params, _outputs) {
    const cvOut = ctx.deps.cvOut;
    if (!cvOut) return;
    const ch = Math.max(0, Math.round(+(params.channel ?? 0) as number));
    const v = inputs.signal ?? 0;
    if (Number.isFinite(v)) cvOut.setGraphSource(ch, v as number);
  },
});
