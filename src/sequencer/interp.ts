/**
 * Per-key value interpolation for snapshot lerps.
 *
 * Numbers   → linear lerp.
 * Hex color → channel-wise lerp on RGB.
 * Booleans  → step at t >= 0.5.
 * Strings/objects/arrays/enums → step at t >= 0.5 (use `step`/`hold` easing
 *   on the keyframe to control direction).
 */

import { Settings } from '../state/Settings';
import { tintHexFor } from '../state/colorModes';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseHexColor(s: string): [number, number, number] {
  const r = parseInt(s.slice(1, 3), 16);
  const g = parseInt(s.slice(3, 5), 16);
  const b = parseInt(s.slice(5, 7), 16);
  return [r, g, b];
}

function toHexColor(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function lerpValue(a: unknown, b: unknown, t: number): unknown {
  // Identical → no work.
  if (a === b) return a;

  // Both numbers.
  if (typeof a === 'number' && typeof b === 'number') {
    return lerpNumber(a, b, t);
  }

  // Both hex colors.
  if (typeof a === 'string' && typeof b === 'string'
    && HEX_COLOR_RE.test(a) && HEX_COLOR_RE.test(b)) {
    const [ar, ag, ab] = parseHexColor(a);
    const [br, bg, bb] = parseHexColor(b);
    return toHexColor(
      lerpNumber(ar, br, t),
      lerpNumber(ag, bg, t),
      lerpNumber(ab, bb, t),
    );
  }

  // Booleans / enums / strings / arrays / objects: step at midpoint.
  return t >= 0.5 ? b : a;
}

/**
 * Interpolate every key present in either snapshot and return a Partial<Settings>
 * containing the result. Excluded keys are dropped on the floor.
 *
 * `prevApplied` (optional): the result of the previous frame's lerp. If given,
 * we omit keys whose interpolated value is unchanged vs prevApplied so the
 * caller's `batchUpdate` doesn't churn unchanged settings.
 */
export function lerpSnapshot(
  a: Partial<Settings>,
  b: Partial<Settings>,
  t: number,
  excluded: ReadonlySet<string>,
  prevApplied?: Partial<Settings>,
): Partial<Settings> {
  const out: Partial<Settings> = {};
  // Union of keys.
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (excluded.has(k)) continue;
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    // If only one side defines the key, treat the other as having the same
    // value (no transition). Skip if both are undefined.
    const aDefined = av !== undefined;
    const bDefined = bv !== undefined;
    if (!aDefined && !bDefined) continue;
    const fromV = aDefined ? av : bv;
    const toV   = bDefined ? bv : av;
    const v = lerpValue(fromV, toV, t);
    if (prevApplied !== undefined
      && Object.is((prevApplied as Record<string, unknown>)[k], v)) {
      continue;
    }
    (out as Record<string, unknown>)[k] = v;
  }
  blendColorMode(a, b, t, excluded, prevApplied, out);
  return out;
}

/**
 * Color Mode is an enum, so the generic rule would hard-cut it at the midpoint. Every mode but
 * 'video' is a tint on brightness (grayscale = white), so between two such modes we glide the
 * TINT instead: mid-segment the raster draws in Custom mode with the blended colour; each end
 * lands exactly on its own snapshot's mode + customTint. A change to or from 'video' still steps.
 */
function blendColorMode(
  a: Partial<Settings>, b: Partial<Settings>, t: number,
  excluded: ReadonlySet<string>, prevApplied: Partial<Settings> | undefined, out: Partial<Settings>,
): void {
  if (excluded.has('colorMode') || excluded.has('customTint')) return;
  const am = a.colorMode, bm = b.colorMode;
  if (!am || !bm || am === bm || t <= 0 || t >= 1) return;
  const at = tintHexFor(am, a.customTint ?? b.customTint ?? '#ffffff');
  const bt = tintHexFor(bm, b.customTint ?? a.customTint ?? '#ffffff');
  if (!at || !bt) return;
  const set = <K extends 'colorMode' | 'customTint'>(k: K, v: Settings[K]): void => {
    if (prevApplied && Object.is(prevApplied[k], v)) { delete out[k]; return; }
    out[k] = v;
  };
  set('colorMode', 'phosphorCustom');
  set('customTint', lerpValue(at, bt, t) as string);
}

/**
 * Apply a snapshot exactly (no interpolation). Excluded keys are dropped.
 * Used when fewer than 2 keyframes exist or when `preview()` is called.
 */
export function pickSnapshot(
  s: Partial<Settings>,
  excluded: ReadonlySet<string>,
): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(s)) {
    if (excluded.has(k)) continue;
    (out as Record<string, unknown>)[k] = (s as Record<string, unknown>)[k];
  }
  return out;
}
