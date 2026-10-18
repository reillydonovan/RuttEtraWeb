import { describe, it, expect } from 'vitest';
import { patchSwing, solveSwing, swingEditable, fmtSwing } from '../patchRange';
import { applyOutputStage } from '../outputStage';

const BIP = [-1, 1] as const;
const UNI = [0, 1] as const;

describe('patchSwing', () => {
  it('default stage, bipolar source: knob ± amount', () => {
    expect(patchSwing({ base: 0.9, amount: 0.5, span: BIP, stage: {} })).toEqual({ from: 0.4, to: 1.4 });
  });
  it('unipolar source only reaches from the knob up (default stage maps 0 → middle)', () => {
    const s = patchSwing({ base: 0, amount: 1, span: UNI, stage: {} });
    expect(s.from).toBeCloseTo(0);
    expect(s.to).toBeCloseTo(1);
  });
  it('invert swaps the ends', () => {
    const s = patchSwing({ base: 0, amount: 1, span: BIP, stage: { outputInvert: true } });
    expect(s).toEqual({ from: 1, to: -1 });
  });
  it('multiply mode scales the knob', () => {
    const s = patchSwing({ base: 2, amount: 0.5, mode: 'multiplicative', span: BIP, stage: {} });
    expect(s.from).toBeCloseTo(1);
    expect(s.to).toBeCloseTo(3);
  });
});

describe('solveSwing', () => {
  const cases = [
    { name: 'bipolar linear', span: BIP, stage: {} },
    { name: 'unipolar', span: UNI, stage: {} },
    { name: 'exp curve', span: BIP, stage: { outputCurve: 'exp' as const } },
    { name: 's curve + invert', span: BIP, stage: { outputCurve: 's' as const, outputInvert: true } },
    { name: 'LFO at depth 0.5', span: [-0.5, 0.5] as const, stage: {} },
  ];
  for (const c of cases) {
    it(`lands exactly on From and To (${c.name})`, () => {
      const base = 0.9, amount = 0.7;
      const sol = solveSwing({ base, amount, span: c.span, stage: c.stage, from: 0.2, to: 1.6 })!;
      expect(sol).not.toBeNull();
      const stage = { ...c.stage, outputMin: sol.outputMin, outputMax: sol.outputMax, outputOffset: sol.outputOffset };
      const sw = patchSwing({ base, amount: sol.amount, span: c.span, stage });
      expect(sw.from).toBeCloseTo(0.2, 9);
      expect(sw.to).toBeCloseTo(1.6, 9);
    });
  }
  it('keeps Amount; sets it to 1 only when it is 0', () => {
    expect(solveSwing({ base: 0, amount: 0.3, span: BIP, stage: {}, from: -1, to: 1 })!.amount).toBe(0.3);
    expect(solveSwing({ base: 0, amount: 0, span: BIP, stage: {}, from: -1, to: 1 })!.amount).toBe(1);
  });
  it('multiply mode', () => {
    const sol = solveSwing({ base: 2, amount: 1, mode: 'multiplicative', span: BIP, stage: {}, from: 1, to: 5 })!;
    const stage = { outputMin: sol.outputMin, outputMax: sol.outputMax, outputOffset: 0 };
    const sw = patchSwing({ base: 2, amount: sol.amount, mode: 'multiplicative', span: BIP, stage });
    expect(sw.from).toBeCloseTo(1); expect(sw.to).toBeCloseTo(5);
  });
  it('From above To works (an inverted sweep)', () => {
    const sol = solveSwing({ base: 0, amount: 1, span: BIP, stage: {}, from: 1, to: -1 })!;
    expect(applyOutputStage(-1, { outputMin: sol.outputMin, outputMax: sol.outputMax })).toBeCloseTo(1);
  });
  it('refuses a source that does not move, and multiply with a zero knob', () => {
    expect(swingEditable({ base: 0, span: [0.4, 0.4], stage: {} })).toBe(false);
    expect(solveSwing({ base: 0, amount: 1, span: [0.4, 0.4], stage: {}, from: 0, to: 1 })).toBeNull();
    expect(solveSwing({ base: 0, amount: 1, mode: 'multiplicative', span: BIP, stage: {}, from: 0, to: 1 })).toBeNull();
  });
  it('step curve: the two extremes still separate', () => {
    expect(swingEditable({ base: 0, span: BIP, stage: { outputCurve: 'step' } })).toBe(true);
  });
});

describe('fmtSwing', () => {
  it('trims to readable numbers', () => {
    expect(fmtSwing(1.6)).toBe('1.6');
    expect(fmtSwing(0.123456)).toBe('0.1235');
    expect(fmtSwing(1.3333333)).toBe('1.333');
    expect(fmtSwing(NaN)).toBe('—');
  });
});

import { generatorSpan, graphSpan } from '../patchRange';

describe('generatorSpan (mirrors ModMatrix.readSource)', () => {
  it('waves: ±depth bipolar, a depth-wide middle band unipolar', () => {
    expect(generatorSpan({ source: 'sine', lfoDepth: 1 })).toEqual([-1, 1]);
    expect(generatorSpan({ source: 'saw', lfoDepth: 0.5 })).toEqual([-0.5, 0.5]);
    expect(generatorSpan({ source: 'sine', lfoDepth: 1, lfoUnipolar: true })).toEqual([0, 1]);
    expect(generatorSpan({ source: 'sine', lfoDepth: 0.5, lfoUnipolar: true })).toEqual([0.25, 0.75]);
  });
  it('constant sits still; other sources are widened to ±1', () => {
    expect(generatorSpan({ source: 'constant', constantValue: 0.3 })).toEqual([0.3, 0.3]);
    expect(generatorSpan({ source: 'audio' })).toEqual([-1, 1]);
  });
});

describe('graphSpan', () => {
  const lfo = { outputs: [{ name: 'out', range: (p: Record<string, unknown>) => (p.bipolar === false ? [0, 1] as const : [-1, 1] as const) }], params: { bipolar: { default: true } } };
  it('reads the port range with the node params (defaults filled in)', () => {
    expect(graphSpan(lfo, 'out', {})).toEqual([-1, 1]);
    expect(graphSpan(lfo, undefined, { bipolar: false })).toEqual([0, 1]);
  });
  it('falls back to ±1 with no declared range', () => {
    expect(graphSpan({ outputs: [{ name: 'out' }], params: {} }, 'out', {})).toEqual([-1, 1]);
    expect(graphSpan(undefined, 'out', {})).toEqual([-1, 1]);
  });
});
