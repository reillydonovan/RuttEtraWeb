/**
 * A patch's swing in the TARGET's own units — the "Range" row on every modulation patch
 * (function generator or Graph binding, in Controls and the Patch Bay).
 *
 * Both engines compute a target's live value the same way (ModMatrix / GraphEngine):
 *
 *   shaped = applyOutputStage(source, stage)        // curve → invert → Min..Max → + Offset
 *   additive:        live = base + amount · shaped
 *   multiplicative:  live = base · (1 + amount · shaped)
 *
 * `patchSwing` runs that forward at the source's two extremes (its span) to say where the
 * target goes: "H Position 0.20 → 1.60". `solveSwing` runs it backwards: given the From and
 * To the user typed, it returns the Min / Max (and Offset 0) that land exactly there, keeping
 * Amount (set to 1 only when it is 0). The remap to Min..Max is linear in the curved signal,
 * so the solve is exact for every curve. Pure — tested in __tests__/patchRange.test.ts.
 */

import { applyOutputStage, applyCurve, readOutputStage, type OutputStageParams } from './outputStage';

export type ApplyMode = 'additive' | 'multiplicative';
export type Span = readonly [number, number];

export interface SwingInput {
  /** The target's knob (base) value. */
  base: number;
  amount: number;
  mode?: ApplyMode;
  /** The source's value at its low and high extremes, before the output stage. */
  span: Span;
  stage: Partial<OutputStageParams>;
}

export interface Swing { from: number; to: number }

const live = (i: SwingInput, s: number): number => {
  const shaped = applyOutputStage(s, i.stage) * i.amount;
  return (i.mode ?? 'additive') === 'multiplicative' ? i.base * (1 + shaped) : i.base + shaped;
};

/** Where the target goes when the source sits at its low (from) and high (to) extreme. */
export function patchSwing(i: SwingInput): Swing {
  return { from: live(i, i.span[0]), to: live(i, i.span[1]) };
}

/** True when From and To can be set independently (the source actually moves). */
export function swingEditable(i: Pick<SwingInput, 'span' | 'stage' | 'base' | 'mode'>): boolean {
  const st = readOutputStage(i.stage);
  const c = (s: number): number => (st.outputInvert ? -1 : 1) * applyCurve(s, st.outputCurve);
  if (Math.abs(c(i.span[1]) - c(i.span[0])) < 1e-9) return false;
  return !((i.mode ?? 'additive') === 'multiplicative' && Math.abs(i.base) < 1e-9);
}

export interface SwingSolution {
  amount: number;
  outputMin: number;
  outputMax: number;
  outputOffset: number;
}

/**
 * The output-stage settings that make the target swing from `from` to `to`, or null when
 * that can't be expressed (a source that doesn't move, or Multiply with a zero knob).
 */
export function solveSwing(i: SwingInput & { from: number; to: number }): SwingSolution | null {
  if (!swingEditable(i)) return null;
  const st = readOutputStage(i.stage);
  const amount = Math.abs(i.amount) < 1e-9 ? 1 : i.amount;
  const mult = (i.mode ?? 'additive') === 'multiplicative';
  // Contribution wanted from the stage at each extreme (before × amount).
  const want = (target: number): number => (mult ? target / i.base - 1 : target - i.base) / amount;
  const vLo = want(i.from), vHi = want(i.to);
  // Stage output = Min + (Max − Min)·(u + 1)/2, u = the curved (and inverted) source.
  const c = (s: number): number => (st.outputInvert ? -1 : 1) * applyCurve(s, st.outputCurve);
  const uLo = c(i.span[0]), uHi = c(i.span[1]);
  const k = (vHi - vLo) / ((uHi - uLo) / 2);
  const outputMin = vLo - k * (uLo + 1) / 2;
  return { amount, outputMin, outputMax: outputMin + k, outputOffset: 0 };
}

/** Readable number for the Range row: 4 significant digits, trailing zeros trimmed. */
export function fmtSwing(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a !== 0 && (a >= 1e4 || a < 1e-3) ? v.toExponential(2) : v.toPrecision(4);
  return String(Number(s));
}

/**
 * A function generator's source span, as ModMatrix.readSource produces it: wave sources run
 * ±Depth (or the middle Depth-wide band when unipolar), Constant sits at its value, and every
 * other source is widened to −1..+1 before the output stage.
 */
export function generatorSpan(slot: { source: string; lfoDepth?: number; lfoUnipolar?: boolean; constantValue?: number }): Span {
  if (['sine', 'triangle', 'square', 'saw', 'pulse'].includes(slot.source)) {
    const d = Math.max(0, Math.min(1, slot.lfoDepth ?? 1));
    return slot.lfoUnipolar ? [(1 - d) / 2, (1 + d) / 2] : [-d, d];
  }
  if (slot.source === 'constant') {
    const c = Math.max(-1, Math.min(1, slot.constantValue ?? 0));
    return [c, c];
  }
  return [-1, 1];
}

type PortRange = readonly [number, number] | ((params: Record<string, number | string | boolean>) => readonly [number, number]);

/** A Graph source's span: its output port's declared range (registry), −1..+1 if none. */
export function graphSpan(
  def: { outputs: ReadonlyArray<{ name: string; range?: PortRange }>; params: Record<string, { default: number | string | boolean }> } | undefined,
  port: string | undefined,
  params: Record<string, number | string | boolean>,
): Span {
  const out = def?.outputs.find((o) => o.name === port) ?? def?.outputs[0];
  const r = out?.range;
  if (!r || !def) return [-1, 1];
  if (typeof r !== 'function') return r;
  const full: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(def.params)) full[k] = params[k] ?? spec.default;
  return r(full);
}
