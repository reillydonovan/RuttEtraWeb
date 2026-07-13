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
    // Note: assert ≥, not ===, so later migration steps don't break this test.
    expect(out._v ?? 0).toBeGreaterThanOrEqual(18);
    const slots = out.modSlots as ModSlot[];
    expect(slots[0].slewRiseMs).toBe(0);
    expect(slots[0].slewFallMs).toBe(0);
    // Pre-existing value preserved, missing companion backfilled.
    expect(slots[1].slewRiseMs).toBe(250);
    expect(slots[1].slewFallMs).toBe(0);
  });

  it('is idempotent', () => {
    const once = migrateSettings({ _v: 17, modSlots: [] });
    expect(once._v ?? 0).toBeGreaterThanOrEqual(18);
    expect(migrateSettings(once)._v).toBe(once._v);
  });
});

describe('migrateSettings v19 -> v20', () => {
  it('backfills mode=additive on saved slots, preserving explicit values', () => {
    const v19 = {
      _v: 19,
      modSlots: [
        { enabled: true, source: 'sine', target: 'zPush', amount: 0.5 },
        { enabled: true, source: 'sine', target: 'zPush', amount: 0.5, mode: 'multiplicative' },
      ],
    };
    const out = migrateSettings(v19);
    expect(out._v ?? 0).toBeGreaterThanOrEqual(20);
    const slots = out.modSlots as ModSlot[];
    expect(slots[0].mode).toBe('additive');
    expect(slots[1].mode).toBe('multiplicative');
  });
});

describe('migrateSettings v20 -> v21', () => {
  it('backfills rotation=0 and freqRange=mid', () => {
    const v20 = {
      _v: 20,
      modSlots: [{ enabled: true, source: 'sine', target: 'zPush', amount: 0.5 }],
    };
    const out = migrateSettings(v20);
    expect(out._v ?? 0).toBeGreaterThanOrEqual(21);
    expect(out.rotation).toBe(0);
    expect((out.modSlots as ModSlot[])[0].freqRange).toBe('mid');
    // Explicit values preserved.
    const kept = migrateSettings({ _v: 20, rotation: 45, modSlots: [{ freqRange: 'high' }] });
    expect(kept.rotation).toBe(45);
    expect((kept.modSlots as ModSlot[])[0].freqRange).toBe('high');
  });
});

describe('migrateSettings v22 -> v23 (dual raster)', () => {
  it('backfills the flag OFF and every b* key at raster-A defaults', () => {
    const out = migrateSettings({ _v: 22 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(23);
    expect(out.dualRasterEnabled).toBe(false);
    expect(out.dualMode).toBe('wipe');
    expect(out.dualTracePos).toBe(0);
    expect(out.bHSize).toBe(1);
    expect(out.bZPush).toBe(0.9);
    expect(out.bThreshold).toBe(0.04);
  });

  it('preserves explicit values and is idempotent', () => {
    const kept = migrateSettings({ _v: 22, dualRasterEnabled: true, bZPush: 2 });
    // The flag is a persisted preference (visual-only) — NOT force-reset.
    expect(kept.dualRasterEnabled).toBe(true);
    expect(kept.bZPush).toBe(2);
    expect(migrateSettings(kept)._v).toBe(kept._v);
  });
});

describe('migrateSettings v23 -> v24 (shaped feedback + analog character)', () => {
  it('backfills defaults that preserve pre-v24 rendering exactly', () => {
    const out = migrateSettings({ _v: 23 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(24);
    expect(out.feedbackShape).toBe('full');
    expect(out.analogEnabled).toBe(false);
    expect(out.feedbackShapeX).toBe(0.5);
    expect(out.analogNoise).toBe(0.15);
  });

  it('preserves explicit values', () => {
    const kept = migrateSettings({ _v: 23, feedbackShape: 'circle', analogEnabled: true, analogHum: 0.5 });
    expect(kept.feedbackShape).toBe('circle');
    // analogEnabled is a persisted visual preference — not force-reset.
    expect(kept.analogEnabled).toBe(true);
    expect(kept.analogHum).toBe(0.5);
  });
});

describe('migrateSettings v25 -> v26 (resizable timeline inspector)', () => {
  it('backfills the default width', () => {
    const out = migrateSettings({ _v: 25 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(26);
    expect(out.timelineInspectorWidth).toBe(220);
  });

  it('preserves an explicit width', () => {
    const kept = migrateSettings({ _v: 25, timelineInspectorWidth: 320 });
    expect(kept.timelineInspectorWidth).toBe(320);
  });
});

describe('migrateSettings v26 -> v27 (resizable control panel)', () => {
  it('backfills the default width', () => {
    const out = migrateSettings({ _v: 26 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(27);
    expect(out.panelWidth).toBe(360);
  });

  it('preserves an explicit width', () => {
    const kept = migrateSettings({ _v: 26, panelWidth: 480 });
    expect(kept.panelWidth).toBe(480);
  });
});

describe('migrateSettings v27 -> v28 (timeline readout format)', () => {
  it('backfills bars/beats defaults', () => {
    const out = migrateSettings({ _v: 27 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(28);
    expect(out.timelineReadoutFormat).toBe('bars');
    expect(out.timelineReadoutFps).toBe(30);
    expect(out.timelineReadoutSampleRate).toBe(48000);
  });

  it('preserves explicit values', () => {
    const kept = migrateSettings({
      _v: 27, timelineReadoutFormat: 'timecode', timelineReadoutFps: 24, timelineReadoutSampleRate: 44100,
    });
    expect(kept.timelineReadoutFormat).toBe('timecode');
    expect(kept.timelineReadoutFps).toBe(24);
    expect(kept.timelineReadoutSampleRate).toBe(44100);
  });
});

describe('migrateSettings v28 -> v29 (workspace regions)', () => {
  it('backfills the stock assignment (panel side, timeline dock)', () => {
    const out = migrateSettings({ _v: 28 });
    expect(out._v ?? 0).toBeGreaterThanOrEqual(29);
    expect(out.panelRegionView).toBe('panel');
    expect(out.dockRegionView).toBe('timeline');
  });

  it('preserves an explicit valid assignment', () => {
    const kept = migrateSettings({ _v: 28, panelRegionView: 'timeline', dockRegionView: 'panel' });
    expect(kept.panelRegionView).toBe('timeline');
    expect(kept.dockRegionView).toBe('panel');
  });

  it('normalizes foreign view ids to defaults', () => {
    const out = migrateSettings({ _v: 28, panelRegionView: 'holodeck', dockRegionView: 'timeline' });
    expect(out.panelRegionView).toBe('panel');
    expect(out.dockRegionView).toBe('timeline');
  });

  it('resolves a same-view collision to the stock assignment', () => {
    const out = migrateSettings({ _v: 28, panelRegionView: 'timeline', dockRegionView: 'timeline' });
    expect(out.panelRegionView).toBe('panel');
    expect(out.dockRegionView).toBe('timeline');
  });
});
