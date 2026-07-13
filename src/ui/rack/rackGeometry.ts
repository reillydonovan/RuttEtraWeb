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

/** Cables implied by graph bindings (read-only in the rack, v1). */
export function graphCables(patch: GraphPatch | null | undefined): GraphCable[] {
  if (!patch) return [];
  return patch.bindings.map((b) => ({
    bindingId: b.id,
    paramKey: b.paramKey,
    enabled: b.enabled !== false,
  }));
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
