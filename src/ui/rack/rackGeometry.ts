/**
 * Pure helpers for the rack skin's patch-cable layer. Everything here is
 * DOM-free and unit-tested; RackLayer.ts owns the DOM/canvas side.
 *
 * The rack's cable model v1 (see docs/design/skeuomorphic-skin.md §3):
 * a Classic mod slot is a module with ONE output jack, and its `target`
 * param is the input jack the cable is plugged into. Creating/moving/
 * removing a cable is exactly an edit of `Settings.modSlots[i].target`
 * — patch data, written through `settings.set` like the Modulation
 * section's own Target dropdown (NOT a live-value write; the base/live
 * split is untouched by cables).
 */

import type { ModSlot, ModTarget } from '../../state/Settings';
import { splitInputRef, type GraphPatch } from '../../modulation/graph/types';

export interface Pt { x: number; y: number }

export interface ClassicCable {
  slotIndex: number;
  target: string;
  /** Disabled slots keep their cable, drawn dimmed — like a patched but
   *  muted module. */
  enabled: boolean;
}

/** A wired connection from one graph node's output port into another
 *  graph node's input port (`GraphNode.inputs[port]` — distinct from a
 *  `TargetBinding`, which feeds a Settings param instead). */
export interface NodeWire {
  targetNodeId: string;
  targetPort: string;
  sourceNodeId: string;
  /** '' means the source's default (first) output port. */
  sourcePort: string;
}

export interface GraphCable {
  bindingId: string;
  paramKey: string;
  enabled: boolean;
  /** Which graph node (and optionally which of its output ports)
   *  actually produces this binding's value — the Patch Bay uses this
   *  to draw the cable from that node's own jack instead of one
   *  generic "GRAPH ENGINE" point (owner feedback: a single shared
   *  anchor made every graph-sourced cable look identical regardless
   *  of which node — LFO, Audio Band, etc. — was really driving it). */
  sourceNodeId: string;
  sourcePort?: string;
}

/** Cables implied by the Classic matrix: one per slot with a real target. */
export function classicCables(slots: readonly ModSlot[]): ClassicCable[] {
  const out: ClassicCable[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.target && s.target !== 'none') {
      out.push({ slotIndex: i, target: s.target as string, enabled: s.enabled });
    }
  }
  return out;
}

/** Cables implied by graph bindings. Draggable in the Patch Bay from the
 *  param (target) end, same as Classic cables — see
 *  `graphBindingForParam`/`applyGraphBindingTarget`. */
export function graphCables(patch: GraphPatch | null | undefined): GraphCable[] {
  if (!patch) return [];
  return patch.bindings.map((b) => ({
    bindingId: b.id,
    paramKey: b.paramKey,
    enabled: b.enabled !== false,
    sourceNodeId: b.sourceNodeId,
    sourcePort: b.sourcePort,
  }));
}

/**
 * Id of the last binding (last in array, mirroring `slotForParam`'s
 * tie-break) whose target is `paramKey`, or null. 'none'-targeted
 * bindings (unplugged, see `applyGraphBindingTarget`) don't count.
 */
export function graphBindingForParam(patch: GraphPatch | null | undefined, paramKey: string): string | null {
  if (!patch) return null;
  for (let i = patch.bindings.length - 1; i >= 0; i--) {
    const b = patch.bindings[i];
    if (b.paramKey === paramKey && b.paramKey !== 'none') return b.id;
  }
  return null;
}

/**
 * Re-plug a graph binding's target ('none' = unplug). Returns a new
 * `GraphPatch` (bindings array replaced wholesale, nodes untouched) —
 * same wholesale-array convention as `applyCableTarget`. The binding
 * itself is kept (not deleted) on unplug, so it can be re-targeted
 * later from the Graph editor, mirroring how a Classic slot's cable
 * unplugs to 'none' without deleting the slot.
 */
export function applyGraphBindingTarget(patch: GraphPatch, bindingId: string, paramKey: string): GraphPatch {
  // A parameter may never modulate itself: re-routing a param-out cable
  // back onto the parameter it reads is refused (owner report: unplug a
  // param->param cable, drop it on the source param's own input -> a
  // feedback loop). The patch comes back unchanged.
  const b0 = patch.bindings.find((b) => b.id === bindingId);
  if (b0 && isSelfModulation(patch, b0.sourceNodeId, paramKey)) return patch;
  return {
    ...patch,
    bindings: patch.bindings.map((b) => (b.id === bindingId ? { ...b, paramKey } : b)),
  };
}

/** Every currently-wired node-to-node input connection in the patch
 *  (`GraphNode.inputs[port]` refs, resolved via the shared
 *  `splitInputRef` parser — the same one the engine/topo-sort/editor
 *  use, so this reads exactly what they'd read). */
export function nodeWires(patch: GraphPatch | null | undefined): NodeWire[] {
  if (!patch) return [];
  const out: NodeWire[] = [];
  for (const n of patch.nodes) {
    for (const [port, ref] of Object.entries(n.inputs)) {
      if (!ref) continue;
      const { nodeId: sourceNodeId, port: sourcePort } = splitInputRef(ref);
      out.push({ targetNodeId: n.id, targetPort: port, sourceNodeId, sourcePort: sourcePort ?? '' });
    }
  }
  return out;
}

/**
 * Remove a node and everything that referenced it: any other node's
 * input port wired to it (`inputs[port]` refs, matched via
 * `splitInputRef` the same way `nodeWires` reads them) gets unplugged
 * to `null`, and any binding it sourced is dropped outright (a binding
 * with no source node is meaningless, unlike a param jack unplugging
 * to `'none'` — that keeps the binding for later re-use, this doesn't
 * since the node itself is gone). Shared by the Graph editor
 * (AdvancedView.ts) and the Patch Bay's own delete-node gesture — one
 * authoritative deletion so both surfaces stay consistent.
 */
export function deleteGraphNode(patch: GraphPatch, nodeId: string): GraphPatch {
  const nodes = patch.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => {
      let changed = false;
      const inputs = { ...n.inputs };
      for (const [port, ref] of Object.entries(inputs)) {
        if (ref && splitInputRef(ref).nodeId === nodeId) { inputs[port] = null; changed = true; }
      }
      return changed ? { ...n, inputs } : n;
    });
  return {
    ...patch,
    nodes,
    bindings: patch.bindings.filter((b) => b.sourceNodeId !== nodeId),
  };
}

/**
 * Wire (or unplug, `ref: null`) one node's input port. `ref` follows the
 * engine's own convention (`splitInputRef`): a plain node id reads that
 * node's default/first output; `nodeId#port` names a specific output on
 * a multi-output node. Returns a new `GraphPatch` (nodes array replaced
 * wholesale, bindings untouched) — same wholesale-array convention as
 * `applyGraphBindingTarget`.
 */
export function applyNodeInputRef(
  patch: GraphPatch,
  nodeId: string,
  port: string,
  ref: string | null,
): GraphPatch {
  return {
    ...patch,
    nodes: patch.nodes.map((n) => (n.id === nodeId ? { ...n, inputs: { ...n.inputs, [port]: ref } } : n)),
  };
}

/**
 * Re-plug slot `index`'s cable into `target` ('none' = unplug). Returns
 * a new array (Settings arrays are replaced wholesale, matching
 * ModulationSection's own write pattern). Plugging a cable INTO a param
 * also enables the slot — that's what the physical gesture means; the
 * unplug leaves `enabled` alone so re-plugging doesn't surprise.
 */
export function applyCableTarget(
  slots: readonly ModSlot[],
  index: number,
  target: ModTarget | 'none',
): ModSlot[] {
  return slots.map((s, i) => {
    if (i !== index) return s;
    return target === 'none'
      ? { ...s, target }
      : { ...s, target, enabled: true };
  });
}

/**
 * Re-plug slot `index`'s SOURCE side (patch bay: dragging a signal jack
 * into a slot's SRC IN). Same enable-on-plug semantics as
 * `applyCableTarget`; same wholesale-array write pattern.
 */
export function applyCableSource(
  slots: readonly ModSlot[],
  index: number,
  source: ModSlot['source'],
): ModSlot[] {
  return slots.map((s, i) => (i === index ? { ...s, source, enabled: true } : s));
}

/**
 * Index of the last slot whose cable is plugged into `paramKey`, or -1.
 * "Last" so that when two slots share a target, grabbing the input jack
 * picks up the most recently added cable first.
 */
export function slotForParam(slots: readonly ModSlot[], paramKey: string): number {
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].target === paramKey) return i;
  }
  return -1;
}

/** Nearest jack within `maxDist` of `p`, or null. */
export function nearestJack<T extends Pt>(jacks: readonly T[], p: Pt, maxDist: number): T | null {
  let best: T | null = null;
  let bestD = maxDist;
  for (const j of jacks) {
    const d = Math.hypot(j.x - p.x, j.y - p.y);
    if (d <= bestD) { bestD = d; best = j; }
  }
  return best;
}

/** Center of a DOMRect-shaped box (plain data so it's testable). */
export function rectCenter(r: { left: number; top: number; width: number; height: number }): Pt {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Graph node/binding id in the format every graph-editing surface uses
 *  (BeginnerView, AdvancedView, PatchBayView). Never contains '#', which
 *  the `nodeId#port` ref syntax relies on. */
export function genGraphId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/**
 * Find — or create — the `param-out` node that reads `paramKey`'s live
 * value as a signal (one per param, so repeated drags from the same
 * param's OUT jack reuse it instead of piling up duplicates).
 */
export function ensureParamOutNode(
  patch: GraphPatch | null | undefined,
  paramKey: string,
  genId: (prefix: string) => string = genGraphId,
): { patch: GraphPatch; nodeId: string } {
  const p: GraphPatch = patch ?? { nodes: [], bindings: [] };
  const existing = p.nodes.find((n) => n.type === 'param-out' && String(n.params.key) === paramKey);
  if (existing) return { patch: p, nodeId: existing.id };
  const nodeId = genId('n');
  return {
    patch: { ...p, nodes: [...p.nodes, { id: nodeId, type: 'param-out', params: { key: paramKey }, inputs: {} }] },
    nodeId,
  };
}

/**
 * Patch one param's OUT jack into another param's IN jack: a binding
 * from `fromKey`'s `param-out` node to `toKey`. Shared by the Patch Bay
 * faceplate and the rack skin's Controls panel, so a param→param cable
 * made on either surface is the same patch data and shows on both.
 * Idempotent: an identical existing binding is left alone. Self-patching
 * (fromKey === toKey) is refused — a degenerate one-frame loop.
 */
export function bindParamOut(
  patch: GraphPatch | null | undefined,
  fromKey: string,
  toKey: string,
  genId: (prefix: string) => string = genGraphId,
): GraphPatch {
  const base: GraphPatch = patch ?? { nodes: [], bindings: [] };
  if (fromKey === toKey) return base;
  const { patch: p, nodeId } = ensureParamOutNode(base, fromKey, genId);
  if (p.bindings.some((b) => b.sourceNodeId === nodeId && b.paramKey === toKey)) return p;
  return {
    ...p,
    bindings: [...p.bindings, { id: genId('b'), paramKey: toKey, sourceNodeId: nodeId, amount: 0.25, mode: 'additive' }],
  };
}

/** The Settings key a `param-out` node reads, or null for any other node. */
export function paramOutKeyOf(patch: GraphPatch | null | undefined, nodeId: string): string | null {
  const n = patch?.nodes.find((x) => x.id === nodeId);
  return n && n.type === 'param-out' ? String(n.params.key) : null;
}

/** True when a binding sourced from `sourceNodeId` landing on `paramKey`
 *  would make that parameter modulate itself — the source is the
 *  parameter's own `param-out` node. Every binding write path checks it
 *  (applyGraphBindingTarget, the Patch Bay's node-OUT binding, bindParamOut
 *  via its fromKey === toKey guard). */
export function isSelfModulation(patch: GraphPatch | null | undefined, sourceNodeId: string, paramKey: string): boolean {
  return paramKey !== 'none' && paramOutKeyOf(patch, sourceNodeId) === paramKey;
}
