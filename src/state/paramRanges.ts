/**
 * Per-parameter user range overrides (v19, AUDIT item 16b).
 *
 * Every slider ships with designed bounds, but performers sometimes want
 * more headroom (push zPush past its stock ±4) or less (a tight vernier
 * around a sweet spot). An override widens or narrows the CONTROL only:
 *
 *   - It affects what the UI can dial in (base values).
 *   - It does NOT clamp live values — modulation can already push a
 *     param beyond its slider bounds, and the base/live split keeps
 *     that behavior unchanged.
 *
 * Overrides are stored in `Settings.paramRangeOverrides` so they persist
 * and travel inside Projects like any other Settings key.
 *
 * Safety envelope: an override may extend at most `EXPANSION`× the
 * designed span beyond either designed bound. That's enough for "way
 * past stock" artistic abuse while keeping pathological values (a
 * 10^9-row scan rate that hangs the GPU building geometry) out of reach.
 */

export interface RangeOverride {
  min: number;
  max: number;
}

/** How many designed-spans an override may extend past each bound. */
export const RANGE_EXPANSION = 5;

/**
 * Normalize a requested override against the designed bounds.
 * Returns null when the request is unusable (non-finite, or collapses
 * to a zero/negative span) — callers treat null as "no override".
 */
export function clampRangeOverride(
  defMin: number,
  defMax: number,
  wantMin: number,
  wantMax: number,
): RangeOverride | null {
  if (!Number.isFinite(wantMin) || !Number.isFinite(wantMax)) return null;
  const span = defMax - defMin;
  if (!(span > 0)) return null;
  const envMin = defMin - RANGE_EXPANSION * span;
  const envMax = defMax + RANGE_EXPANSION * span;
  const min = Math.max(envMin, Math.min(wantMin, wantMax));
  const max = Math.min(envMax, Math.max(wantMin, wantMax));
  if (!(max > min)) return null;
  return { min, max };
}

/**
 * True when an override is meaningfully different from the designed
 * bounds (within float noise) — identical overrides should be dropped
 * rather than stored.
 */
export function isDefaultRange(defMin: number, defMax: number, o: RangeOverride): boolean {
  const eps = (defMax - defMin) * 1e-9;
  return Math.abs(o.min - defMin) <= eps && Math.abs(o.max - defMax) <= eps;
}
