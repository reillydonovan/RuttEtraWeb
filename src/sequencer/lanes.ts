/**
 * Automation-lane evaluation (Keyframing v2 data layer, AUDIT item 25).
 *
 * Pure functions — no DOM, no store access — so the offset math is
 * exhaustively testable. Semantics (per the owner decision recorded in
 * AUDIT.md):
 *
 *   - Lane values are RELATIVE OFFSETS. They are pushed into
 *     `LiveValuesStore` under the 'timeline' namespace, summing with the
 *     base and with both modulation engines: lanes are a third
 *     offset-writer, like CV into an input sums with the knob.
 *   - Between points: interpolate with the incoming point's easing
 *     (same "easing INTO this keyframe" convention as preset keyframes).
 *   - Outside the point range: clamp-hold the first/last value.
 *   - Empty or disabled lanes contribute nothing (and, via the
 *     same-frame `setContributions` clear, snap their target to base).
 */

import { AutomationLane, AutomationPoint, EasingType } from './types';
import { applyEasing } from './easings';

/** Evaluate one lane's offset at `bar`. Points must be sorted by bar. */
export function evalLane(points: AutomationPoint[], bar: number): number {
  if (points.length === 0) return 0;
  if (bar <= points[0].bar) return points[0].value;
  const last = points[points.length - 1];
  if (bar >= last.bar) return last.value;
  // Find the bracketing pair (points are sorted; lanes are small — a
  // linear scan is fine and branch-predictable).
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (bar <= b.bar) {
      const a = points[i - 1];
      const span = b.bar - a.bar;
      const t = span <= 0 ? 1 : (bar - a.bar) / span;
      const eased = applyEasing((b.easing ?? 'linear') as EasingType, t);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

/**
 * Offsets for every enabled lane at `bar`. Multiple lanes on the same
 * param sum (matching the summing-amplifier convention everywhere else).
 */
export function laneOffsets(lanes: AutomationLane[], bar: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const lane of lanes) {
    if (!lane.enabled || lane.points.length === 0) continue;
    const v = evalLane(lane.points, bar);
    if (v === 0) continue;
    out.set(lane.paramKey, (out.get(lane.paramKey) ?? 0) + v);
  }
  return out;
}

/** Insert-or-replace a point at `bar` (exact-bar match replaces), keeping order. */
export function upsertPoint(points: AutomationPoint[], point: AutomationPoint): AutomationPoint[] {
  const next = points.filter((p) => p.bar !== point.bar);
  next.push({ ...point });
  next.sort((a, b) => a.bar - b.bar);
  return next;
}

export function removePointAt(points: AutomationPoint[], bar: number): AutomationPoint[] {
  return points.filter((p) => p.bar !== bar);
}
