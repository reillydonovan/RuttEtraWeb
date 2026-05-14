/**
 * One-way conversion from a Classic 4-slot ModMatrix patch into an
 * equivalent signal-graph patch.
 *
 * Each enabled slot becomes a single source node + a single binding.
 * Classic-specific knobs that don't have a graph analog (clock-sync,
 * MIDI-out, ramp parameters' precise shape) are mapped to the closest
 * graph parameter or dropped with a comment.
 *
 * Conversion is **explicit** — the user clicks "Convert to Graph". Old
 * presets never auto-convert.
 */

import { ModSlot } from '../../state/Settings';
import { GraphNode, GraphPatch, NodeType, TargetBinding } from './types';

export function classicToGraph(slots: ModSlot[]): GraphPatch {
  const nodes: GraphNode[] = [];
  const bindings: TargetBinding[] = [];

  let yCursor = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.enabled || slot.target === 'none') continue;

    const sourceNode = slotToSourceNode(slot, i);
    if (!sourceNode) continue;
    sourceNode.position = { x: 40, y: yCursor };
    yCursor += 110;
    nodes.push(sourceNode);

    bindings.push({
      id: `b${i + 1}`,
      paramKey: slot.target,
      sourceNodeId: sourceNode.id,
      amount: slot.amount,
      mode: 'additive',
    });
  }

  return { nodes, bindings };
}

function slotToSourceNode(slot: ModSlot, idx: number): GraphNode | null {
  const id = `n${idx + 1}`;
  switch (slot.source) {
    case 'sine':
    case 'triangle':
    case 'square':
    case 'saw':
    case 'pulse':
      return {
        id, type: 'lfo', inputs: {},
        params: {
          shape: slot.source,
          rate: slot.frequency,
          phase: slot.phase,
          duty: slot.duty,
          bipolar: true,
        },
      };
    case 'ramp':
      return {
        id, type: 'ramp', inputs: {},
        params: {
          mode: slot.rampMode === 'hold' ? 'one-shot' : slot.rampMode,
          timeSec: slot.rampTimeSec,
          bipolar: true,
        },
      };
    case 'audio':
      return {
        id, type: 'audio-envelope', inputs: {},
        params: { bipolar: true, gain: 1 },
      };
    case 'audioBand':
      return {
        id, type: 'audio-band', inputs: {},
        params: { band: slot.bandIndex, gain: 1, bipolar: true },
      };
    case 'beat':
      return {
        id, type: 'audio-onset', inputs: {},
        params: { threshold: 0.15, decayMs: 200 },
      };
    case 'midiCC':
      return { id, type: 'midi-cc', inputs: {}, params: { bipolar: true } };
    case 'midiNote':
      return { id, type: 'midi-note', inputs: {}, params: {} };
    case 'midiVelocity':
      // No 1:1 graph node — use midi-note's velocity output. Caller
      // should route from `velocity` port; we simulate by routing via a
      // scale node, but a single node is closer to the Classic intent.
      return { id, type: 'midi-note', inputs: {}, params: {} };
    case 'midiClock':
      return {
        id, type: 'clock', inputs: {},
        params: { source: 'midi', division: slot.clockDivision },
      };
    case 'osc':
      return { id, type: 'osc-in', inputs: {}, params: { bipolar: true } };
    case 'joystickX':
      return { id, type: 'joystick-x', inputs: {}, params: {} };
    case 'joystickY':
      return { id, type: 'joystick-y', inputs: {}, params: {} };
    case 'joystickZ':
      return { id, type: 'joystick-z', inputs: {}, params: {} };
    case 'constant':
      // Classic 'constant' source maps directly to the graph `constant`
      // node. We pass the slot's `constantValue` through the node's
      // `value` param; the binding handles the per-slot `amount`.
      return {
        id, type: 'constant', inputs: {},
        params: { value: slot.constantValue },
      };
    case 'cvAudio':
      return {
        id, type: 'cv-input', inputs: {},
        params: { route: 'audio', channel: slot.cvChannel, bipolar: true },
      };
    case 'cvOsc':
      return {
        id, type: 'cv-input', inputs: {},
        params: { route: 'osc', channel: slot.cvChannel, bipolar: true },
      };
    case 'gamepadAxis':
      return {
        id, type: 'gamepad-axis', inputs: {},
        params: { axis: slot.gamepadIndex },
      };
    case 'gamepadBtn':
      return {
        id, type: 'gamepad-button', inputs: {},
        params: { button: slot.gamepadIndex, bipolar: false },
      };
  }
}

/** Graph node types that the inverse mapping above can produce. */
export const CLASSIC_SOURCE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  'lfo', 'ramp', 'audio-envelope', 'audio-band', 'audio-onset',
  'midi-cc', 'midi-note', 'clock', 'osc-in',
  'joystick-x', 'joystick-y', 'joystick-z',
  'constant',
  'cv-input', 'gamepad-axis', 'gamepad-button',
]);
