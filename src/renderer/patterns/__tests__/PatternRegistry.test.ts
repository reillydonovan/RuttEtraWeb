import { describe, expect, it } from 'vitest';
import {
  PATTERN_REGISTRY, PATTERN_ORDER, PATTERN_CATEGORY_LABEL,
  BLEND_MODE_INDEX, getPatternDef,
  PATTERN_QUAD_VERT_SRC, PATTERN_COMPOSITOR_FRAG_SRC,
} from '../PatternRegistry';
import type { PatternKind, PatternBlendMode } from '../../../state/Settings';

const ALL_KINDS: PatternKind[] = [
  'solid', 'gradient', 'bars', 'grid', 'checker',
  'sineBands', 'triangleBands', 'sawBands', 'squareBands', 'pulseBands',
  'lissajous', 'spiral',
  'whiteNoise', 'perlinNoise', 'worleyNoise',
  'oscilloscope',
];

const ALL_BLENDS: PatternBlendMode[] = [
  'replace', 'add', 'subtract', 'multiply',
  'screen', 'difference', 'mask', 'crossfade',
];

describe('PatternRegistry', () => {
  it('has an entry for every PatternKind', () => {
    for (const k of ALL_KINDS) {
      const def = PATTERN_REGISTRY[k];
      expect(def, `missing entry for "${k}"`).toBeDefined();
      expect(def.kind).toBe(k);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.fragSrc.length).toBeGreaterThan(20);
      expect(def.paramKeys.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('PATTERN_ORDER lists every kind exactly once', () => {
    expect(PATTERN_ORDER.length).toBe(ALL_KINDS.length);
    expect(new Set(PATTERN_ORDER)).toEqual(new Set(ALL_KINDS));
  });

  it('every category has a human-readable label', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      expect(PATTERN_CATEGORY_LABEL[def.category]).toBeTruthy();
    }
  });

  it('defaults only mention keys that appear in paramKeys', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      const allowed = new Set<string>(def.paramKeys);
      for (const k of Object.keys(def.defaults)) {
        expect(
          allowed.has(k),
          `${def.kind}: defaults.${k} is not listed in paramKeys`,
        ).toBe(true);
      }
    }
  });

  it('every fragSrc compiles to non-trivial GLSL (has a main())', () => {
    for (const def of Object.values(PATTERN_REGISTRY)) {
      expect(def.fragSrc.includes('void main')).toBe(true);
    }
  });

  it('shared assets are present', () => {
    expect(PATTERN_QUAD_VERT_SRC.includes('void main')).toBe(true);
    expect(PATTERN_COMPOSITOR_FRAG_SRC.includes('uBlendMode')).toBe(true);
    expect(PATTERN_COMPOSITOR_FRAG_SRC.includes('uMix')).toBe(true);
  });

  it('BLEND_MODE_INDEX covers every PatternBlendMode and assigns unique ints', () => {
    const seen = new Set<number>();
    for (const m of ALL_BLENDS) {
      const idx = BLEND_MODE_INDEX[m];
      expect(typeof idx, `blend mode "${m}" missing`).toBe('number');
      expect(seen.has(idx), `duplicate index ${idx} for "${m}"`).toBe(false);
      seen.add(idx);
    }
  });

  it('getPatternDef returns the same object as the registry', () => {
    expect(getPatternDef('sineBands')).toBe(PATTERN_REGISTRY.sineBands);
  });

  it('oscilloscope reads scope-source ref + sweep + persist params', () => {
    const def = PATTERN_REGISTRY.oscilloscope;
    expect(def.paramKeys).toContain('patternScopeSourceKind');
    expect(def.paramKeys).toContain('patternScopeSourceRef');
    expect(def.paramKeys).toContain('patternScopeSweep');
    expect(def.paramKeys).toContain('patternScopePersist');
  });
});
