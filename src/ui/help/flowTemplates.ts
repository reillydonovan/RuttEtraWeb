/**
 * Static signal-flow diagrams for the About page (owner ask, 2026-09-30:
 * "it's flooded in text and would be nice to have some imagery").
 *
 * Two kinds, both drawn by `flowSvg()` — the same renderer as the live
 * diagrams in the ⓘ pop-ups, so the manual and the app look alike:
 *   - `nodeTemplateFlow(def)`: a node's ports from its registry
 *     definition (Node Catalog — one per node, always current).
 *   - `ABOUT_FLOWS`: a few hand-picked example patches, placed in the
 *     manual's Markdown as `<div class="about-flow" data-flow="<id>">`.
 *
 * Type-only imports: the About bundle must stay free of synth runtime
 * (scripts/check-about-bundle.cjs).
 */

import type { NodeDef } from '../../modulation/graph/types';
import type { FlowKind, FlowModel, FlowPort } from './signalFlow';

const portKind = (k: string): FlowKind => (k === 'video' ? 'video' : 'wire');

/** A node's ports as a diagram: inputs waiting for a cable, outputs ready to patch. */
export function nodeTemplateFlow(def: Pick<NodeDef, 'label' | 'inputs' | 'outputs'>): FlowModel {
  return {
    title: def.label,
    inputs: def.inputs.map((p) => ({ name: p.label ?? p.name, kind: portKind(p.kind), links: [], empty: `${p.kind} in` })),
    outputs: def.outputs.map((p) => ({ name: p.label ?? p.name, kind: 'graph', links: [], empty: `${p.kind} → a param or IN` })),
  };
}

const port = (name: string, kind: FlowKind, links: string[], empty?: string): FlowPort =>
  ({ name, kind, links: links.map((label) => ({ label, kind })), empty });

/** Hand-picked example patches for the manual (keyed by data-flow id). */
export const ABOUT_FLOWS: Record<string, FlowModel> = {
  'core-path': {
    title: 'Display Control Unit',
    inputs: [
      port('VIDEO', 'video', ['Camera / file / screen', 'or Pattern Generator']),
      port('MOD', 'mod', ['Function Generators', 'Graph nodes · MIDI · audio']),
    ],
    outputs: [port('RASTER', 'video', ['Virtual Camera', 'Post FX → Output'])],
  },
  'function-gen': {
    title: 'Function Gen 1',
    inputs: [port('SRC IN', 'wave', ['SINE (Sources bus)'])],
    outputs: [port('OUT', 'mod', ['Z Push'])],
  },
  'graph-lfo': {
    title: 'LFO',
    inputs: [],
    outputs: [
      { name: 'out', kind: 'graph', links: [
        { label: 'H Position', kind: 'graph' },
        { label: 'Scope · in', kind: 'wire' },
      ] },
    ],
  },
  'composite': {
    title: 'Composite',
    inputs: [
      port('A', 'video', ['Video Source A']),
      port('B', 'video', ['Pattern Generator']),
    ],
    outputs: [port('OUT', 'video', ['Renderer'])],
  },
  'dual-raster': {
    title: 'Dual Raster',
    inputs: [
      port('A', 'video', ['Video Source A']),
      port('B', 'video', ['Video Source B']),
    ],
    outputs: [port('OUT', 'video', ['Renderer'])],
  },
};
