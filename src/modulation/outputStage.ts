/**
 * Shared per-output-stage shaping used by both ModMatrix (Classic) and
 * GraphEngine (binding writeback).
 *
 * Order matches the master spec diagram:
 *
 *   raw source
 *     -> source-specific (depth / bipolar / etc.)
 *     -> [outputStage]: curve -> invert -> range remap -> offset
 *     -> * amount
 *     -> sum
 *
 * Defaults (curve=linear, min=-1, max=1, offset=0, invert=false) are an
 * exact identity transform: applyOutputStage(x, defaults) === x. A unit
 * test pins this so the wiring can never silently regress.
 */
import { OutputCurve } from '../state/Settings';

export interface OutputStageParams {
  outputCurve: OutputCurve;
  outputMin: number;
  outputMax: number;
  outputOffset: number;
  outputInvert: boolean;
}

/**
 * Defaults applied when an OutputStageParams field is missing on the
 * source object (e.g. older `TargetBinding` JSON without output fields).
 */
export const DEFAULT_OUTPUT_STAGE: OutputStageParams = {
  outputCurve: 'linear',
  outputMin: -1,
  outputMax: 1,
  outputOffset: 0,
  outputInvert: false,
};

/**
 * Read an `OutputStageParams` view of an object that may be missing some
 * fields (e.g. legacy `TargetBinding` without output-stage fields). All
 * five defaults are filled with the spec values.
 */
export function readOutputStage(src: Partial<OutputStageParams> | null | undefined): OutputStageParams {
  if (!src) return DEFAULT_OUTPUT_STAGE;
  return {
    outputCurve:  src.outputCurve  ?? DEFAULT_OUTPUT_STAGE.outputCurve,
    outputMin:    src.outputMin    ?? DEFAULT_OUTPUT_STAGE.outputMin,
    outputMax:    src.outputMax    ?? DEFAULT_OUTPUT_STAGE.outputMax,
    outputOffset: src.outputOffset ?? DEFAULT_OUTPUT_STAGE.outputOffset,
    outputInvert: src.outputInvert ?? DEFAULT_OUTPUT_STAGE.outputInvert,
  };
}

/**
 * Apply the output stage to a value `v` (typically in -1..+1 for bipolar
 * sources or 0..+1 for unipolar). Order:
 *
 *   1. Curve (linear / exp / log / S / step)
 *   2. Invert (flip sign of curved value)
 *   3. Range remap from [-1, +1] -> [outputMin, outputMax]
 *   4. Offset add
 *
 * At defaults this is the identity transform so an "untouched" patch
 * matches pre-Stage-3 ModMatrix behaviour exactly.
 */
export function applyOutputStage(v: number, p: Partial<OutputStageParams> | null | undefined): number {
  const params = readOutputStage(p);
  let curved = applyCurve(v, params.outputCurve);
  if (params.outputInvert) curved = -curved;
  const t = (curved + 1) * 0.5;
  const lo = params.outputMin;
  const hi = params.outputMax;
  let mapped = lo + (hi - lo) * t;
  mapped += params.outputOffset;
  return mapped;
}

/** Curve shapes for the output stage. Input/output both in [-1, +1]. */
export function applyCurve(v: number, curve: OutputCurve): number {
  switch (curve) {
    case 'linear': return v;
    case 'exp': {
      const sign = Math.sign(v);
      const a = Math.abs(v);
      return sign * (a * a);
    }
    case 'log': {
      const sign = Math.sign(v);
      const a = Math.abs(v);
      return sign * Math.sqrt(a);
    }
    case 's': {
      const t = (v + 1) * 0.5;
      const s = t * t * (3 - 2 * t);
      return s * 2 - 1;
    }
    case 'step': {
      if (v >  0.33) return  1;
      if (v < -0.33) return -1;
      return 0;
    }
  }
}

/**
 * Exponential rise/fall slew limiter — the single shared implementation
 * used by the Graph `slew` node and (v18) Classic per-slot slew.
 *
 * `1 - exp(-dt/tau)` keeps the approach dt-agnostic; tau at or below
 * 0.5 ms is treated as "off" (returns the target exactly), matching the
 * Graph node's historical threshold.
 *
 * @param current  Last output value.
 * @param target   This frame's input value.
 * @param dtSec    Frame delta in seconds.
 * @param riseMs   Time constant when the signal is rising.
 * @param fallMs   Time constant when the signal is falling.
 */
export function slewToward(
  current: number,
  target: number,
  dtSec: number,
  riseMs: number,
  fallMs: number,
): number {
  const tau = (target > current ? riseMs : fallMs) / 1000;
  if (tau <= 0.0005) return target;
  const k = 1 - Math.exp(-dtSec / tau);
  return current + (target - current) * k;
}
