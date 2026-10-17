import { describe, it, expect } from 'vitest';
import '../bootstrap';
import { allDefs, getDef } from '../registry';
import type { NodeDef, PortSpec } from '../types';

type Params = Record<string, number | string | boolean>;

function defaultParams(def: NodeDef<unknown>): Params {
  const out: Params = {};
  for (const [k, spec] of Object.entries(def.params)) out[k] = spec.default;
  return out;
}

function resolve(port: PortSpec, params: Params): readonly [number, number] {
  const r = port.range;
  if (r === undefined) throw new Error(`port ${port.name} has no range`);
  return typeof r === 'function' ? r(params) : r;
}

describe('output port ranges', () => {
  it('every output of every node declares a range', () => {
    const missing: string[] = [];
    for (const def of allDefs()) {
      for (const port of def.outputs) {
        if (port.range === undefined) missing.push(`${def.type}.${port.name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('each range resolves with default params to finite lo <= hi', () => {
    for (const def of allDefs()) {
      const params = defaultParams(def);
      for (const port of def.outputs) {
        const [lo, hi] = resolve(port, params);
        expect(Number.isFinite(lo), `${def.type}.${port.name} lo`).toBe(true);
        expect(Number.isFinite(hi), `${def.type}.${port.name} hi`).toBe(true);
        expect(lo, `${def.type}.${port.name}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('LFO is -1..1 by default and 0..1 when unipolar', () => {
    const def = getDef('lfo')!;
    const port = def.outputs[0];
    const params = defaultParams(def);
    expect(resolve(port, params)).toEqual([-1, 1]);
    expect(resolve(port, { ...params, bipolar: false })).toEqual([0, 1]);
  });
});
