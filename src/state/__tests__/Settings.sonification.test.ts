import { describe, expect, it } from 'vitest';
import { migrateSettings, DEFAULT_SONIFICATION } from '../Settings';

describe('migrateSettings — sonification safety + backfill', () => {
  it('v9 → v10 adds the sonification block with default config', () => {
    const v9 = { _v: 9 };
    const out = migrateSettings(v9) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification).toBeDefined();
    expect(out.sonification.enabled).toBe(false);
    expect(out.sonification.masterVolumeDb).toBe(-18);
    expect(out.sonification.waveform).toBe(DEFAULT_SONIFICATION.waveform);
    expect(out.sonification.mappings.pitch.source).toBe('verticalCentroid');
  });

  it('preserves user-tweaked partial sonification config when migrating', () => {
    const v9WithPartial = {
      _v: 9,
      sonification: {
        masterVolumeDb: -6,
        smoothingMs: 150,
      },
    };
    const out = migrateSettings(v9WithPartial) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification.masterVolumeDb).toBe(-6);
    expect(out.sonification.smoothingMs).toBe(150);
    // Untouched fields fall back to defaults.
    expect(out.sonification.waveform).toBe(DEFAULT_SONIFICATION.waveform);
    expect(out.sonification.mappings.pitch.source).toBe('verticalCentroid');
  });

  it('preserves per-mapping partial overrides on migration', () => {
    const v9 = {
      _v: 9,
      sonification: {
        mappings: {
          pitch: { source: 'peakRow', curve: 'linear' },
          // amplitude / cutoff / resonance not specified — should keep defaults
        },
      },
    };
    const out = migrateSettings(v9) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification.mappings.pitch.source).toBe('peakRow');
    expect(out.sonification.mappings.pitch.curve).toBe('linear');
    expect(out.sonification.mappings.amplitude.source)
      .toBe(DEFAULT_SONIFICATION.mappings.amplitude.source);
    expect(out.sonification.mappings.cutoff.source)
      .toBe(DEFAULT_SONIFICATION.mappings.cutoff.source);
    expect(out.sonification.mappings.resonance.source)
      .toBe(DEFAULT_SONIFICATION.mappings.resonance.source);
  });

  it('ALWAYS forces sonification.enabled = false (the cardinal safety rule)', () => {
    const v9WithEnabled = {
      _v: 9,
      sonification: {
        enabled: true,
        masterVolumeDb: 0,
      },
    };
    const out = migrateSettings(v9WithEnabled) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification.enabled).toBe(false);
    // ...but the user's volume preference IS preserved (as the spec
    // requires: "saved configurations are restored, but output is
    // not auto-started").
    expect(out.sonification.masterVolumeDb).toBe(0);
  });

  it('forces enabled = false on a v10 record too (post-version belt-and-braces)', () => {
    const v10WithEnabled = {
      _v: 10,
      sonification: {
        ...DEFAULT_SONIFICATION,
        enabled: true,
      },
    };
    const out = migrateSettings(v10WithEnabled) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification.enabled).toBe(false);
  });

  it('handles missing sonification on v10 records (fills with defaults)', () => {
    const v10NoSon = { _v: 10 };
    const out = migrateSettings(v10NoSon) as { sonification: typeof DEFAULT_SONIFICATION };
    expect(out.sonification).toBeDefined();
    expect(out.sonification.enabled).toBe(false);
    expect(out.sonification.masterVolumeDb).toBe(-18);
  });
});
