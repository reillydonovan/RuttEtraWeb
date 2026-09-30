/**
 * Signal-flow model for the ⓘ info modal's diagram (owner ask,
 * 2026-09-30: "a dataviz graphic of each node in their info modal with
 * supporting graphics for input sources and output destinations").
 *
 * Built from the LIVE patch — what is actually plugged into / out of
 * this node right now — read from a plain `FlowState` snapshot of
 * Settings (modSlots, modGraph, the video routing keys). Pure and
 * DOM-free; `flowSvg.ts` draws it. Same data the Patch Bay's cables
 * are drawn from, so the diagram can't disagree with the bay.
 */

import type { GraphPatch } from '../../modulation/graph/types';
import { splitInputRef } from '../../modulation/graph/types';
import { getDef } from '../../modulation/graph/registry';
import type { ModMode, ModSlot, SettingsStore } from '../../state/Settings';
import { SOURCE_JACKS } from '../patchbay/patchbayLayout';
import { moduleKey, paramLabel } from './infoContent';

export type FlowKind = 'mod' | 'graph' | 'wire' | 'video' | 'wave';

export interface FlowLink {
  label: string;
  kind: FlowKind;
  /** Connected but not currently doing anything (muted, or the engine
   *  that carries it is switched off by Modulation mode). */
  idle?: boolean;
}
export interface FlowPort {
  name: string;
  kind: FlowKind;
  links: FlowLink[];
  /** Text for an unplugged port's stub. */
  empty?: string;
}
export interface FlowModel {
  title: string;
  inputs: FlowPort[];
  outputs: FlowPort[];
  /** Parameters in this unit that have no cable at all (collapsed). */
  unpatched?: number;
}

type VideoId = 'sourceA' | 'sourceB' | 'composite' | 'dualRaster' | 'pattern' | 'none';

export interface FlowState {
  modSlots: ReadonlyArray<Pick<ModSlot, 'enabled' | 'source' | 'target'>>;
  modMode: ModMode;
  graph: GraphPatch | null;
  video: {
    rendererIn: VideoId;
    compositeInA: VideoId;
    compositeInB: VideoId;
    dualRasterInA: VideoId;
    dualRasterInB: VideoId;
  };
}

export function flowStateOf(settings: SettingsStore): FlowState {
  return {
    modSlots: settings.get('modSlots'),
    modMode: settings.get('modMode'),
    graph: settings.get('modGraph') ?? null,
    video: {
      rendererIn: settings.get('videoRendererIn'),
      compositeInA: settings.get('videoCompositeInA'),
      compositeInB: settings.get('videoCompositeInB'),
      dualRasterInA: settings.get('videoDualRasterInA'),
      dualRasterInB: settings.get('videoDualRasterInB'),
    },
  };
}

// ------------------------------------------------------------------ labels

const WAVE_LABEL = new Map<string, string>(SOURCE_JACKS.map((j) => [j.source, j.label]));
const waveLabel = (s: string): string => WAVE_LABEL.get(s) ?? s.toUpperCase();

const classicLive = (s: FlowState): boolean => s.modMode !== 'graph';
const graphLive = (s: FlowState): boolean => s.modMode !== 'classic';

/** "LFO", or "Param OUT" nodes as "<param> OUT". */
export function nodeLabel(graph: GraphPatch | null, nodeId: string): string {
  const n = graph?.nodes.find((x) => x.id === nodeId);
  if (!n) return nodeId;
  if (n.type === 'param-out') return `${paramLabel(String(n.params.key))} OUT`;
  const label = getDef(n.type)?.label ?? n.type;
  const same = graph!.nodes.filter((x) => x.type === n.type);
  return same.length > 1 ? `${label} ${same.indexOf(n) + 1}` : label;
}

function defaultPort(graph: GraphPatch | null, nodeId: string): string {
  const n = graph?.nodes.find((x) => x.id === nodeId);
  return (n && getDef(n.type)?.outputs[0]?.name) ?? 'out';
}

function nodeOn(graph: GraphPatch | null, nodeId: string): boolean {
  return graph?.nodes.find((x) => x.id === nodeId)?.enabled !== false;
}

/** Everything modulating `key`: Classic slots + graph bindings. */
function modulatorsOf(s: FlowState, key: string): FlowLink[] {
  const out: FlowLink[] = [];
  s.modSlots.forEach((slot, i) => {
    if (slot.target === key) out.push({ label: `Function Gen ${i + 1}`, kind: 'mod', idle: !slot.enabled || !classicLive(s) });
  });
  for (const b of s.graph?.bindings ?? []) {
    if (b.paramKey !== key) continue;
    out.push({ label: nodeLabel(s.graph, b.sourceNodeId), kind: 'graph', idle: b.enabled === false || !nodeOn(s.graph, b.sourceNodeId) || !graphLive(s) });
  }
  return out;
}

/** Everything `key`'s OUT jack drives (through its param-out node). */
function drivenBy(s: FlowState, key: string): FlowLink[] {
  const po = s.graph?.nodes.find((n) => n.type === 'param-out' && String(n.params.key) === key);
  return po ? nodeOutLinks(s, po.id, null) : [];
}

/** Destinations of a node output (`port` null = every port). */
function nodeOutLinks(s: FlowState, nodeId: string, port: string | null): FlowLink[] {
  const g = s.graph;
  const def0 = defaultPort(g, nodeId);
  const on = nodeOn(g, nodeId) && graphLive(s);
  const out: FlowLink[] = [];
  for (const b of g?.bindings ?? []) {
    if (b.sourceNodeId !== nodeId) continue;
    if (port !== null && (b.sourcePort || def0) !== port) continue;
    out.push({ label: paramLabel(b.paramKey), kind: 'graph', idle: !on || b.enabled === false });
  }
  for (const n of g?.nodes ?? []) {
    for (const [inPort, ref] of Object.entries(n.inputs)) {
      if (!ref) continue;
      const r = splitInputRef(ref);
      if (r.nodeId !== nodeId) continue;
      if (port !== null && (r.port ?? def0) !== port) continue;
      const inLabel = getDef(n.type)?.inputs.find((p) => p.name === inPort)?.label ?? inPort;
      out.push({ label: `${nodeLabel(g, n.id)} · ${inLabel}`, kind: 'wire', idle: !on || n.enabled === false });
    }
  }
  return out;
}

// ------------------------------------------------------------------ builders

/** A graph node: its declared inputs and outputs, with live cables. */
export function nodeFlow(s: FlowState, nodeId: string): FlowModel | null {
  const g = s.graph;
  const n = g?.nodes.find((x) => x.id === nodeId);
  const def = n ? getDef(n.type) : null;
  if (!n || !def) return null;
  const inputs: FlowPort[] = def.inputs.map((p) => {
    const ref = n.inputs[p.name];
    const links: FlowLink[] = [];
    if (ref) {
      const r = splitInputRef(ref);
      const srcNode = g!.nodes.find((x) => x.id === r.nodeId);
      const multi = ((srcNode && getDef(srcNode.type)?.outputs.length) ?? 0) > 1;
      const port = r.port ?? defaultPort(g, r.nodeId);
      links.push({
        label: nodeLabel(g, r.nodeId) + (multi ? ` · ${port}` : ''),
        kind: 'wire',
        idle: !nodeOn(g, r.nodeId) || !graphLive(s),
      });
    }
    return { name: p.label ?? p.name, kind: 'wire', links, empty: 'not patched' };
  });
  if (n.type === 'param-out') {
    inputs.unshift({ name: 'knob', kind: 'graph', links: [{ label: paramLabel(String(n.params.key)), kind: 'graph' }] });
  }
  const outputs: FlowPort[] = def.outputs.map((p) => ({
    name: p.label ?? p.name,
    kind: 'graph',
    links: nodeOutLinks(s, nodeId, p.name),
    empty: 'drag OUT to a parameter',
  }));
  return { title: nodeLabel(g, nodeId), inputs, outputs };
}

/** Parameters (a faceplate field or Controls section): only the patched
 *  ones get rows; the rest are counted. */
export function paramsFlow(s: FlowState, title: string, keys: readonly string[]): FlowModel {
  const seen = new Set<string>();
  const inputs: FlowPort[] = [];
  const outputs: FlowPort[] = [];
  let unpatched = 0;
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const ins = modulatorsOf(s, k);
    const outs = drivenBy(s, k);
    if (ins.length) inputs.push({ name: paramLabel(k), kind: ins[0].kind, links: ins });
    if (outs.length) outputs.push({ name: paramLabel(k), kind: 'graph', links: outs });
    if (!ins.length && !outs.length) unpatched++;
  }
  // Nothing patched at all: still draw the unit, with its first few
  // parameters as empty IN jacks and an empty OUT stub (owner: the
  // pop-ups should have a picture, not just text).
  if (!inputs.length && !outputs.length && seen.size) {
    const idle = [...seen].slice(0, IDLE_ROWS);
    return {
      title,
      inputs: idle.map((k) => ({ name: paramLabel(k), kind: 'mod' as const, links: [], empty: 'drag an OUT here' })),
      outputs: [{ name: 'OUT jacks', kind: 'graph', links: [], empty: 'to any IN' }],
      unpatched: seen.size - idle.length,
    };
  }
  return { title, inputs, outputs, unpatched };
}

/** Parameters drawn as empty jacks when a unit has no cables at all. */
const IDLE_ROWS = 5;

/** A Function Generator (Classic slot `i`). */
export function slotFlow(s: FlowState, i: number): FlowModel | null {
  const slot = s.modSlots[i];
  if (!slot) return null;
  const idle = !slot.enabled || !classicLive(s);
  return {
    title: `Function Gen ${i + 1}`,
    inputs: [{ name: 'SRC IN', kind: 'wave', links: [{ label: waveLabel(slot.source), kind: 'wave', idle }] }],
    outputs: [{
      name: 'OUT',
      kind: 'mod',
      links: slot.target && slot.target !== 'none' ? [{ label: paramLabel(String(slot.target)), kind: 'mod', idle }] : [],
      empty: 'drag OUT to a parameter',
    }],
  };
}

/** The SOURCES bus: each waveform that some generator is using. */
export function busFlow(s: FlowState): FlowModel {
  const by = new Map<string, FlowLink[]>();
  s.modSlots.forEach((slot, i) => {
    const l = by.get(slot.source) ?? [];
    l.push({ label: `Function Gen ${i + 1} · SRC`, kind: 'wave', idle: !slot.enabled || !classicLive(s) });
    by.set(slot.source, l);
  });
  const outputs = SOURCE_JACKS.filter((j) => by.has(j.source))
    .map((j) => ({ name: j.label, kind: 'wave' as const, links: by.get(j.source)! }));
  return { title: 'Sources', inputs: [], outputs, unpatched: SOURCE_JACKS.length - outputs.length };
}

const VIDEO_NAME: Record<Exclude<VideoId, 'none'>, string> = {
  sourceA: 'Video Source A', sourceB: 'Video Source B', composite: 'Composite', dualRaster: 'Dual Raster',
  pattern: 'Pattern Generator',
};

function videoIn(name: string, src: VideoId, empty: string): FlowPort {
  return { name, kind: 'video', links: src === 'none' ? [] : [{ label: VIDEO_NAME[src], kind: 'video' }], empty };
}

/** Where video `id`'s OUT goes. */
function videoOuts(s: FlowState, id: Exclude<VideoId, 'none'>): FlowLink[] {
  const v = s.video;
  const out: FlowLink[] = [];
  if (v.compositeInA === id) out.push({ label: 'Composite · A', kind: 'video' });
  if (v.compositeInB === id) out.push({ label: 'Composite · B', kind: 'video' });
  if (v.dualRasterInA === id) out.push({ label: 'Dual Raster · A', kind: 'video' });
  if (v.dualRasterInB === id) out.push({ label: 'Dual Raster · B', kind: 'video' });
  if (v.rendererIn === id) out.push({ label: 'Renderer', kind: 'video' });
  return out;
}

/** Video-routing half of a module's flow, or null for non-video units. */
function videoFlow(s: FlowState, key: string): { inputs: FlowPort[]; outputs: FlowPort[] } | null {
  const v = s.video;
  const out = (id: Exclude<VideoId, 'none'>): FlowPort =>
    ({ name: 'OUT', kind: 'video', links: videoOuts(s, id), empty: 'not routed' });
  switch (key) {
    case 'VIDEO SOURCE A': return { inputs: [], outputs: [out('sourceA')] };
    case 'VIDEO SOURCE B': return { inputs: [], outputs: [out('sourceB')] };
    case 'COMPOSITE': return {
      inputs: [videoIn('A', v.compositeInA, 'no signal'), videoIn('B', v.compositeInB, 'no signal')],
      outputs: [out('composite')],
    };
    case 'DUAL RASTER': return {
      inputs: [videoIn('A', v.dualRasterInA, 'no signal'), videoIn('B', v.dualRasterInB, 'mirrors A')],
      outputs: [out('dualRaster')],
    };
    case 'RENDERER': return { inputs: [videoIn('IN', v.rendererIn, 'Video Source A')], outputs: [] };
    case 'PATTERN GENERATOR': return { inputs: [], outputs: [{ ...out('pattern'), empty: 'overlay (not patched)' }] };
    default: return null;
  }
}

/** Flow for a Patch Bay hardware module / field (by header text) or a
 *  Controls section (params only). */
export function moduleFlow(s: FlowState, title: string, keys: readonly string[]): FlowModel {
  const key = moduleKey(title);
  if (key === 'FUNCTION GEN') {
    const n = Number(title.trim().split(/\s+/).pop());
    const f = slotFlow(s, Number.isFinite(n) ? n - 1 : -1);
    if (f) return f;
  }
  if (key === 'SOURCES') return busFlow(s);
  const params = paramsFlow(s, title.trim(), keys);
  const video = videoFlow(s, key);
  if (!video) return params;
  return {
    title: params.title,
    inputs: [...video.inputs, ...params.inputs],
    outputs: [...video.outputs, ...params.outputs],
    unpatched: params.unpatched,
  };
}

/** True when there's nothing worth drawing. */
export function flowIsEmpty(f: FlowModel): boolean {
  return f.inputs.length === 0 && f.outputs.length === 0;
}
