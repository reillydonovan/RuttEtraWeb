/**
 * v17 → v18 migration: Classic slot slew fields (AUDIT item 2).
 */
import { describe, it, expect } from 'vitest';
import { migrateSettings, ModSlot } from '../Settings';

describe('migrateSettings v17 -> v18', () => {
  it('backfills slewRiseMs/slewFallMs = 0 on saved slots', () => {
    const v17 = {
      _v: 17,
      modSlots: [
        { enabled: true, source: 'sine', target: 'zPush', amount: 0.5 },
        { enabled: false, source: 'audio', target: 'none', amount: 0, slewRiseMs: 250 },
      ],
    };
    const out = migrateSettings(v17);
    expect(out._v).toBe(18);
    const slots = out.modSlots as ModSlot[];
    expect(slots[0].slewRiseMs).toBe(0);
    expect(slots[0].slewFallMs).toBe(0);
    // Pre-existing value preserved, missing companion backfilled.
    expect(slots[1].slewRiseMs).toBe(250);
    expect(slots[1].slewFallMs).toBe(0);
  });

  it('is idempotent', () => {
    const once = migrateSettings({ _v: 17, modSlots: [] });
    expect(once._v).toBe(18);
    expect(migrateSettings(once)._v).toBe(18);
  });
});
