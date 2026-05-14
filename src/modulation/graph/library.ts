/**
 * Starter patch library — small `GraphPatch` snippets that demonstrate
 * common signal-graph idioms. Loaded into `settings.modGraph` when the
 * user clicks them in the Graph-view sidebar.
 *
 * Each patch is hand-positioned so it lays out reasonably in the
 * advanced view's default canvas.
 */

import { GraphPatch } from './types';

export interface StarterPatch {
  id: string;
  name: string;
  description: string;
  patch: GraphPatch;
}

export const STARTER_PATCHES: StarterPatch[] = [
  {
    id: 'audio-ring-mod',
    name: 'Audio Ring Mod',
    description: 'Audio envelope multiplied by an LFO drives Z-push for a tremolo-style modulation.',
    patch: {
      nodes: [
        { id: 'env',  type: 'audio-envelope', params: { bipolar: false, gain: 1 }, inputs: {}, position: { x: 40,  y: 20 } },
        { id: 'lfo',  type: 'lfo',            params: { shape: 'sine', rate: 4, bipolar: true }, inputs: {}, position: { x: 40,  y: 130 } },
        { id: 'mul',  type: 'multiplier',     params: {}, inputs: { a: 'env', b: 'lfo' }, position: { x: 240, y: 80 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'mul', amount: 0.6, mode: 'additive' },
      ],
    },
  },
  {
    id: 'video-brightness-tracking',
    name: 'Video Brightness Tracking',
    description: 'Video luma over a center region drives intensity. Brighter input → brighter scan lines.',
    patch: {
      nodes: [
        { id: 'luma', type: 'video-luma', params: { rx: 0.25, ry: 0.25, rw: 0.5, rh: 0.5, gain: 1 }, inputs: {}, position: { x: 40, y: 40 } },
        { id: 'slew', type: 'slew',       params: { riseMs: 80, fallMs: 250 }, inputs: { in: 'luma' }, position: { x: 240, y: 40 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'intensity',      sourceNodeId: 'slew', amount: 0.6, mode: 'additive' },
        { id: 'b2', paramKey: 'bloomIntensity', sourceNodeId: 'slew', amount: 0.6, mode: 'additive' },
      ],
    },
  },
  {
    id: 'beat-sequencer',
    name: 'Beat-Synced Step Sequencer',
    description: 'MIDI-clock pulse drives an 8-step sequencer of Z-push offsets.',
    patch: {
      nodes: [
        { id: 'clock', type: 'clock',     params: { source: 'midi', division: '1/8' }, inputs: {}, position: { x: 40, y: 30 } },
        { id: 'seq',   type: 'sequencer', params: { steps: 8, s1: 0, s2: 0.5, s3: -0.25, s4: 0.75, s5: -0.5, s6: 0.5, s7: -0.75, s8: 1 }, inputs: { clock: 'clock' }, position: { x: 220, y: 30 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'seq', amount: 0.5, mode: 'additive' },
      ],
    },
  },
  {
    id: 'motion-glitch',
    name: 'Motion-Triggered Glitch',
    description: 'Motion in the input video triggers a brief gate that pulses chroma + skip.',
    patch: {
      nodes: [
        { id: 'mot',  type: 'video-motion',    params: { rx: 0, ry: 0, rw: 1, rh: 1, gain: 4 }, inputs: {}, position: { x: 40, y: 30 } },
        { id: 'cmp',  type: 'comparator',      params: {}, inputs: { a: 'mot' }, position: { x: 240, y: 30 } },
        { id: 'cst',  type: 'constant',        params: { value: 0.25 }, inputs: {}, position: { x: 40, y: 130 } },
        { id: 'gate', type: 'trigger-to-gate', params: { lengthMs: 220 }, inputs: { in: 'cmp' }, position: { x: 420, y: 30 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'chromaAmount', sourceNodeId: 'gate', amount: 0.02, mode: 'additive' },
        { id: 'b2', paramKey: 'skip',         sourceNodeId: 'gate', amount: 1,    mode: 'additive' },
      ],
    },
  },
  {
    id: 'slewed-pitch',
    name: 'Slewed Pitch Follow',
    description: 'Audio pitch -> slew limiter -> H spin. Sing higher, scene rotates more.',
    patch: {
      nodes: [
        { id: 'pit',  type: 'audio-pitch', params: { minHz: 80, maxHz: 800 }, inputs: {}, position: { x: 40, y: 30 } },
        { id: 'slew', type: 'slew',        params: { riseMs: 200, fallMs: 200 }, inputs: { in: 'pit' }, position: { x: 240, y: 30 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'hSpin', sourceNodeId: 'slew', amount: 1.5, mode: 'additive' },
      ],
    },
  },
  {
    id: 'reactive-crossfade',
    name: 'Reactive Crossfade',
    description: 'Crossfade between two LFOs based on the audio envelope.',
    patch: {
      nodes: [
        { id: 'l1',  type: 'lfo', params: { shape: 'sine',     rate: 0.4, bipolar: true }, inputs: {}, position: { x: 40,  y: 30 } },
        { id: 'l2',  type: 'lfo', params: { shape: 'triangle', rate: 3,   bipolar: true }, inputs: {}, position: { x: 40,  y: 130 } },
        { id: 'env', type: 'audio-envelope', params: {}, inputs: {}, position: { x: 40, y: 230 } },
        { id: 'xf',  type: 'crossfade', params: {}, inputs: { a: 'l1', b: 'l2', x: 'env' }, position: { x: 260, y: 130 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'xf', amount: 0.5, mode: 'additive' },
      ],
    },
  },
  {
    id: 'edge-focus',
    name: 'Edge-Driven Focus',
    description: 'High edge density (busy frame) tightens focus; flat scenes loosen it.',
    patch: {
      nodes: [
        { id: 'edg', type: 'video-edge', params: { rx: 0, ry: 0, rw: 1, rh: 1, gain: 2 }, inputs: {}, position: { x: 40, y: 30 } },
        { id: 'inv', type: 'inverter',  params: {}, inputs: { in: 'edg' }, position: { x: 240, y: 30 } },
        { id: 'sl',  type: 'slew',      params: { riseMs: 300, fallMs: 600 }, inputs: { in: 'inv' }, position: { x: 420, y: 30 } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'focus', sourceNodeId: 'sl', amount: 0.5, mode: 'additive' },
      ],
    },
  },
];
