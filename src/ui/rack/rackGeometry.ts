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
import type { GraphPatch } from '../../modulation/graph/types';

export interface Pt { x: number; y: number }

export interface ClassicCable {
  slotIndex: number;
  target: string;
  /** Disabled slots keep their cable, drawn dimmed — like a patched but
   *  muted module. */
  enabled: boolean;
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
  return {
    ...patch,
    bindings: patch.bindings.map((b) => (b.id === bindingId ? { ...b, paramKey } : b)),
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
