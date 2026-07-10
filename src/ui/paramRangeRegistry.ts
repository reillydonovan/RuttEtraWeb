/**
 * Build-time index of each slider's DESIGNED range.
 *
 * The section call site (`slider(settings, key, min, max, step)`) remains
 * the single authority for a param's designed bounds — this module just
 * records them as sliders are constructed so non-panel consumers (the
 * timeline lane editor's value axis) can look them up without a second
 * hand-maintained table. Params whose sliders haven't been built yet
 * (lazily rebuilt pattern controls, for example) simply return null and
 * callers fall back to a points-derived scale.
 */

export interface DesignedRange {
  min: number;
  max: number;
}

const ranges = new Map<string, DesignedRange>();

export function registerDesignedRange(key: string, min: number, max: number): void {
  ranges.set(key, { min, max });
}

export function getDesignedRange(key: string): DesignedRange | null {
  return ranges.get(key) ?? null;
}
