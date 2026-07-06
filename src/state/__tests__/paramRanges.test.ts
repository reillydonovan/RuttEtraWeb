/**
 * v19: per-parameter slider range overrides (AUDIT item 16b).
 */
import { describe, it, expect } from 'vitest';
import { clampRangeOverride, isDefaultRange, RANGE_EXPANSION } from '../paramRanges';
import { migrateSettings } from '../Settings';

describe('clampRangeOverride', () => {
  it('passes through a valid widened range', () => {
    expect(clampRangeOverride(0, 1, -2, 3)).toEqual({ min: -2, max: 3 });
  });

  it('clamps to the expansion envelope', () => {
    // Designed 0..1, span 1, envelope [-5, +6].
    const o = clampRangeOverride(0, 1, -100, 100)!;
    expect(o.min).toBe(0 - RANGE_EXPANSION * 1);
    expect(o.max).toBe(1 + RANGE_EXPANSION * 1);
  });

  it('swaps inverted bounds instead of rejecting them', () => {
    expect(clampRangeOverride(0, 1, 0.9, 0.1)).toEqual({ min: 0.1, max: 0.9 });
  });

  it('rejects non-finite and zero-span requests', () => {
    expect(clampRangeOverride(0, 1, NaN, 2)).toBeNull();
    expect(clampRangeOverride(0, 1, 0.5, 0.5)).toBeNull();
    expect(clampRangeOverride(0, 0, 0, 1)).toBeNull(); // degenerate designed span
  });

  it('narrowed vernier ranges are allowed', () => {
    expect(clampRangeOverride(-4, 4, 0.8, 1.2)).toEqual({ min: 0.8, max: 1.2 });
  });
});

describe('isDefaultRange', () => {
  it('detects the designed bounds within float noise', () => {
    expect(isDefaultRange(0, 1, { min: 0, max: 1 })).toBe(true);
    expect(isDefaultRange(0, 1, { min: 0, max: 1 + 1e-12 })).toBe(true);
    expect(isDefaultRange(0, 1, { min: 0, max: 1.1 })).toBe(false);
  });
});

describe('migrateSettings v18 -> v19', () => {
  it('backfills an empty override map and preserves an existing one', () => {
    const fresh = migrateSettings({ _v: 18 });
    expect(fresh._v ?? 0).toBeGreaterThanOrEqual(19);
    expect(fresh.paramRangeOverrides).toEqual({});
    const kept = migrateSettings({ _v: 18, paramRangeOverrides: { zPush: { min: -8, max: 8 } } });
    expect(kept.paramRangeOverrides).toEqual({ zPush: { min: -8, max: 8 } });
  });
});
