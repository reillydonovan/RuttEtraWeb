/**
 * Pure maths for drag-to-change on number fields (numberScrub.ts).
 *
 * How far one pixel moves the value:
 * - a field with min and max: the span over ~300 px (so a full sweep is a comfortable drag),
 *   never finer than one step;
 * - an open-ended field: Unity's rule, which grows with the value's size
 *   (max(1, sqrt|v|) x 0.03), never finer than one step.
 */

export interface ScrubField {
  value: number;
  min: number;    // NaN = no minimum
  max: number;    // NaN = no maximum
  step: number;   // NaN = "any"
}

const SWEEP_PX = 300;

export function perPixel(f: ScrubField): number {
  const step = Number.isFinite(f.step) && f.step > 0 ? f.step : 0;
  const span = f.max - f.min;
  const base = Number.isFinite(span) && span > 0
    ? span / SWEEP_PX
    : Math.max(1, Math.sqrt(Math.abs(f.value))) * 0.03;
  return Math.max(step, base);
}

/** Change in value for a drag of `px` pixels (up/right positive). */
export function scrubDelta(px: number, f: ScrubField): number {
  return px * perPixel(f);
}

/** Round to the field's step (relative to 0); "any" keeps 4 decimals. */
export function roundToStep(v: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return Math.round(v * 1e4) / 1e4;
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  const n = Math.round(v / step) * step;
  return Number(n.toFixed(decimals));
}
