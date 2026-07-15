/**
 * Faceplate layout coverage — the guarantee that every modulation
 * target has a home on the patch bay. If someone adds a TARGETS entry
 * without a faceplate field, it must land in the visible AUXILIARY
 * catch-all rather than silently vanishing — and this test tells them.
 *
 * `patternXxx` keys are the one deliberate exception: they're homed on
 * the PATTERN GENERATOR rail module instead (see the
 * `PATTERN_OWNED_PREFIX` comment in patchbayLayout.ts) — a second copy
 * here would silently steal their `paramJacks` Map registration.
 */
import { describe, it, expect } from 'vitest';
import { buildFaceplate, SOURCE_JACKS } from '../patchbayLayout';
import { TARGETS } from '../../targets';

describe('buildFaceplate', () => {
  const fields = buildFaceplate();
  const allKeys = fields.flatMap((f) => f.params.map((p) => p.key));

  it('covers every static TARGETS entry exactly once, except pattern-owned keys', () => {
    const expected = TARGETS.filter((t) => t.v !== 'none' && !String(t.v).startsWith('pattern')).map((t) => String(t.v));
    expect(new Set(allKeys).size).toBe(allKeys.length); // no duplicates
    expect([...allKeys].sort()).toEqual([...expected].sort());
  });

  it('excludes every pattern-owned key (homed on the rail module instead)', () => {
    const patternTargets = TARGETS.filter((t) => t.v !== 'none' && String(t.v).startsWith('pattern')).map((t) => String(t.v));
    expect(patternTargets.length).toBeGreaterThan(0); // sanity: the exclusion is exercised
    for (const key of patternTargets) expect(allKeys).not.toContain(key);
  });

  it('leads with the brochure DCU sub-groups in order', () => {
    const titles = fields.filter((f) => f.column === 1).map((f) => f.title);
    expect(titles.slice(0, 4)).toEqual(['POSITION & SIZE', 'DEPTH', 'BEAM', 'ROTATION']);
    expect(titles).toContain('LUMINANCE');
  });

  it('puts the core DCU params where the hardware had them', () => {
    const pos = fields.find((f) => f.title === 'POSITION & SIZE')!;
    expect(pos.params.map((p) => p.key)).toContain('hPos');
    const depth = fields.find((f) => f.title === 'DEPTH')!;
    expect(depth.params.map((p) => p.key)).toEqual(['zPush', 'zBias']);
  });

  it('labels come from TARGETS (one source of truth)', () => {
    const zPush = fields.flatMap((f) => f.params).find((p) => p.key === 'zPush')!;
    expect(zPush.label).toBe('Z Push');
  });
});

describe('SOURCE_JACKS', () => {
  it('is the performable core, each with a label', () => {
    expect(SOURCE_JACKS.length).toBeGreaterThanOrEqual(8);
    for (const s of SOURCE_JACKS) {
      expect(s.label.length).toBeGreaterThan(0);
    }
    expect(SOURCE_JACKS.map((s) => s.source)).toContain('sine');
    expect(SOURCE_JACKS.map((s) => s.source)).toContain('audio');
  });
});
