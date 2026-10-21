import { describe, expect, it } from 'vitest';
import { KEYS, KEY_NAMES, PRESETS, PATTERN_SOURCES, IMAGE_SOURCE_SETTINGS } from './space.mjs';
import { makeSample, validatePatch, drawPrior, perturb, mulberry32, applyGates, PRESET_IDS } from './sampler.mjs';
import { DEFAULTS } from '../../src/state/Settings';
import { PRESETS as APP_PRESETS } from '../../src/ui/presets';
import { PATTERN_REGISTRY } from '../../src/renderer/patterns/PatternRegistry';

const N = 4000;
const set = (seed, opts) => Array.from({ length: N }, (_, i) => makeSample(seed, i, opts));

describe('copilot look space matches the app', () => {
  it('is the 39-key first set, each default equal to the app DEFAULTS', () => {
    expect(KEY_NAMES).toHaveLength(39);
    for (const k of KEY_NAMES) {
      expect(DEFAULTS, k).toHaveProperty(k);
      expect(KEYS[k].def, k).toEqual(DEFAULTS[k]);
      if (KEYS[k].type === 'number') {
        expect(KEYS[k].def, k).toBeGreaterThanOrEqual(KEYS[k].min);
        expect(KEYS[k].def, k).toBeLessThanOrEqual(KEYS[k].max);
      }
    }
  });

  it('carries the 12 built-in presets exactly, restricted to its keys', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(APP_PRESETS.map((p) => p.id).sort());
    for (const p of APP_PRESETS) {
      const mine = Object.fromEntries(Object.entries(p.values).filter(([k]) => k in KEYS));
      expect(PRESETS[p.id], p.id).toEqual(mine);
    }
  });

  it('sends every parameter of each pattern source kind explicitly (loading a kind applies no defaults)', () => {
    for (const [id, s] of Object.entries(PATTERN_SOURCES)) {
      expect(s.patternEnabled, id).toBe(true);
      expect(s.patternBlendMode, id).toBe('replace');
      for (const k of PATTERN_REGISTRY[s.patternKind].paramKeys) expect(s, `${id} ${k}`).toHaveProperty(k);
      for (const k of Object.keys(s)) expect(typeof s[k], `${id} ${k}`).toBe(typeof DEFAULTS[k]);
    }
    for (const k of Object.keys(IMAGE_SOURCE_SETTINGS)) expect(typeof IMAGE_SOURCE_SETTINGS[k]).toBe(typeof DEFAULTS[k]);
  });
});

describe('copilot sampler', () => {
  const samples = set(7, { imageIds: ['image:a', 'image:b'] });

  it('keeps every key of every sample in its slider range, step and enum (all strata)', () => {
    for (const s of samples) expect(validatePatch(s.patch), s.id).toEqual([]);
    // and the ranges are actually exercised, not just respected
    for (const k of ['zPush', 'threshold', 'scanRate', 'cols', 'hSize', 'rotation', 'feedbackDecay', 'bloomIntensity', 'cameraFov']) {
      const v = samples.map((s) => s.patch[k]);
      const span = Math.max(...v) - Math.min(...v);
      expect(span, k).toBeGreaterThan(0.5 * (KEYS[k].max - KEYS[k].min));
    }
  });

  it('never emits renderMode dots, and pins autoOrbit off', () => {
    expect(samples.some((s) => s.patch.renderMode === 'dots')).toBe(false);
    expect(samples.some((s) => s.patch.renderMode === 'wireframe')).toBe(true);
    expect(samples.every((s) => s.patch.autoOrbit === false)).toBe(true);
  });

  it('is deterministic by seed, and sample i does not depend on how many are asked for', () => {
    expect(set(7, { imageIds: ['image:a', 'image:b'] })).toEqual(samples);
    expect(makeSample(7, 123, { imageIds: ['image:a', 'image:b'] })).toEqual(samples[123]);
    const other = set(8, { imageIds: ['image:a', 'image:b'] });
    expect(other.filter((s, i) => JSON.stringify(s.patch) === JSON.stringify(samples[i].patch)).length).toBeLessThan(N * 0.02);
  });

  it('puts gated values at their default when the switch is off, and varies them when it is on', () => {
    const gated = KEY_NAMES.filter((k) => KEYS[k].gate);
    expect(gated.sort()).toEqual(['analogDropout', 'analogHum', 'analogNoise', 'bloomIntensity', 'bloomRadius', 'bloomThreshold',
      'customTint', 'feedbackDecay', 'scanlineDensity', 'scanlineIntensity', 'vignetteAmount']);
    for (const k of gated) {
      const [gk, gv] = Object.entries(KEYS[k].gate)[0];
      const off = samples.filter((s) => s.patch[gk] !== gv);
      const on = samples.filter((s) => s.patch[gk] === gv);
      expect(off.every((s) => s.patch[k] === KEYS[k].def), k).toBe(true);
      expect(new Set(on.map((s) => s.patch[k])).size, k).toBeGreaterThan(100); // hundreds of distinct values
    }
    // the switches are on in a real fraction of samples, so the values they gate matter
    for (const [g, lo, hi] of [['bloomEnabled', 0.4, 0.85], ['feedbackEnabled', 0.1, 0.4], ['analogEnabled', 0.1, 0.4], ['scanlineEnabled', 0.5, 0.9]]) {
      const f = samples.filter((s) => s.patch[g]).length / N;
      expect(f, g).toBeGreaterThan(lo);
      expect(f, g).toBeLessThan(hi);
    }
  });

  it('stratifies: about 5% exact presets, half near a preset, the rest broad; every preset appears', () => {
    const frac = (st) => samples.filter((s) => s.stratum === st).length / N;
    expect(frac('exact')).toBeGreaterThan(0.03);
    expect(frac('exact')).toBeLessThan(0.07);
    expect(frac('near')).toBeGreaterThan(0.45);
    expect(frac('near')).toBeLessThan(0.55);
    expect(new Set(samples.filter((s) => s.preset).map((s) => s.preset))).toEqual(new Set(PRESET_IDS));
    for (const s of samples.filter((x) => x.stratum === 'exact')) {
      const expected = applyGates({ ...Object.fromEntries(KEY_NAMES.map((k) => [k, KEYS[k].def])), ...PRESETS[s.preset] });
      expect(s.patch, s.id).toEqual(expected);
    }
    // near samples stay near: most keys keep the preset's value
    for (const s of samples.filter((x) => x.stratum === 'near').slice(0, 200)) {
      const base = { ...Object.fromEntries(KEY_NAMES.map((k) => [k, KEYS[k].def])), ...PRESETS[s.preset] };
      const same = KEY_NAMES.filter((k) => s.patch[k] === base[k]).length;
      expect(same, s.id).toBeGreaterThan(KEY_NAMES.length * 0.4);
    }
  });

  it('samples log-scale keys log-uniformly (as many looks below the geometric middle as above)', () => {
    const broad = samples.filter((s) => s.stratum === 'broad');
    for (const k of ['scanRate', 'cols', 'gamma']) {
      const { a, b } = KEYS[k].prior;
      const mid = Math.sqrt(a * b);
      const below = broad.filter((s) => s.patch[k] < mid).length / broad.length;
      expect(below, k).toBeGreaterThan(0.42);
      expect(below, k).toBeLessThan(0.58);
    }
  });

  it('only picks the sources it was given', () => {
    const allowed = new Set([...Object.keys(PATTERN_SOURCES), 'image:a', 'image:b']);
    expect(samples.every((s) => allowed.has(s.source))).toBe(true);
    expect(samples.some((s) => s.source === 'image:a')).toBe(true);
    const patternsOnly = Array.from({ length: 500 }, (_, i) => makeSample(7, i));
    expect(patternsOnly.every((s) => s.source.startsWith('pattern:'))).toBe(true);
  });

  it('draws and perturbs every key inside its range, even from the range edges', () => {
    const r = mulberry32(3);
    for (const k of KEY_NAMES) {
      const spec = KEYS[k];
      for (let i = 0; i < 300; i++) {
        const starts = spec.type === 'number' ? [spec.min, spec.max, drawPrior(r, k)] : [drawPrior(r, k)];
        for (const x of starts) {
          const patch = { ...Object.fromEntries(KEY_NAMES.map((q) => [q, KEYS[q].def])), [k]: perturb(r, k, x) };
          const errs = validatePatch(applyGates(patch)).filter((e) => e.startsWith(`${k}:`));
          expect(errs, k).toEqual([]);
        }
      }
    }
  });

  it('flags what the loader would not catch: out of range, unknown enum, bad colour, open-gate leftovers', () => {
    const ok = Object.fromEntries(KEY_NAMES.map((k) => [k, KEYS[k].def]));
    expect(validatePatch(ok)).toEqual([]);
    expect(validatePatch({ ...ok, zPush: 4.5 })).toEqual(['zPush: 4.5 outside 0..4']);
    expect(validatePatch({ ...ok, renderMode: 'dots' })[0]).toMatch(/renderMode: dots not one of/);
    expect(validatePatch({ ...ok, colorMode: 'blue' })[0]).toMatch(/colorMode: blue/);
    expect(validatePatch({ ...ok, backgroundColor: 'black' })[0]).toMatch(/not #rrggbb/);
    expect(validatePatch({ ...ok, bloomIntensity: 2 })).toEqual(['bloomIntensity: gate closed but value 2 is not the default']);
    expect(validatePatch({ ...ok, extra: 1 })).toEqual(['extra: not a first-set key']);
  });
});
