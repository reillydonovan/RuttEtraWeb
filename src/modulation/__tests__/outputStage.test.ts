import { describe, expect, it } from 'vitest';
import { applyOutputStage, DEFAULT_OUTPUT_STAGE } from '../outputStage';
import { DEFAULT_MOD_SLOT } from '../../state/Settings';

describe('applyOutputStage', () => {
  it('is the identity transform at default settings', () => {
    // 5 sample points across the bipolar range — must match input exactly
    // (within float epsilon) when curve=linear, min=-1, max=1, offset=0,
    // invert=false. This is the regression guard for the master-spec
    // requirement that pre-Stage-3 LFO behavior is preserved.
    for (const v of [-1, -0.5, 0, 0.25, 0.5, 1]) {
      expect(applyOutputStage(v, DEFAULT_OUTPUT_STAGE)).toBeCloseTo(v, 8);
      expect(applyOutputStage(v, DEFAULT_MOD_SLOT)).toBeCloseTo(v, 8);
    }
  });

  it('treats null / partial source object as defaults (identity)', () => {
    expect(applyOutputStage(0.5, null)).toBeCloseTo(0.5, 8);
    expect(applyOutputStage(0.5, {})).toBeCloseTo(0.5, 8);
    expect(applyOutputStage(-0.25, undefined)).toBeCloseTo(-0.25, 8);
  });

  it('inverts before range remap (spec ordering)', () => {
    // Spec ordering: curve -> invert -> range -> offset.
    // For v=0.5, invert -> -0.5, then remap [-1,1] -> [0, 1] (t = 0.25)
    // gives 0.25. If invert ran AFTER range remap we'd get -0.75.
    const out = applyOutputStage(0.5, {
      ...DEFAULT_OUTPUT_STAGE,
      outputMin: 0,
      outputMax: 1,
      outputInvert: true,
    });
    expect(out).toBeCloseTo(0.25, 8);
  });

  it('applies offset after range remap', () => {
    // v=0 -> curve linear -> 0 -> no invert -> remap [-1,1] -> [-1,1]
    // gives 0 -> +0.5 offset -> 0.5.
    const out = applyOutputStage(0, {
      ...DEFAULT_OUTPUT_STAGE,
      outputOffset: 0.5,
    });
    expect(out).toBeCloseTo(0.5, 8);
  });

  it('curve=step quantizes to {-1, 0, 1}', () => {
    expect(applyOutputStage(0.9, { ...DEFAULT_OUTPUT_STAGE, outputCurve: 'step' })).toBeCloseTo(1, 8);
    expect(applyOutputStage(-0.9, { ...DEFAULT_OUTPUT_STAGE, outputCurve: 'step' })).toBeCloseTo(-1, 8);
    expect(applyOutputStage(0.1, { ...DEFAULT_OUTPUT_STAGE, outputCurve: 'step' })).toBeCloseTo(0, 8);
  });
});
