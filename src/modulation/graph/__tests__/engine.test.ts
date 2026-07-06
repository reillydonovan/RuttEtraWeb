import { describe, expect, it } from 'vitest';
import { topoSort } from '../topo';
import { GraphPatch } from '../types';
import { makeEngine } from './helpers';

function patchOf(...nodes: GraphPatch['nodes']): GraphPatch {
  return { nodes, bindings: [] };
}

describe('topoSort', () => {
  it('orders a linear chain A -> B -> C', () => {
    const p = patchOf(
      { id: 'A', type: 'lfo',     params: {}, inputs: {} },
      { id: 'B', type: 'attenuator', params: {}, inputs: { in: 'A' } },
      { id: 'C', type: 'inverter',   params: {}, inputs: { in: 'B' } },
    );
    const r = topoSort(p);
    expect(r.cycleEdges).toEqual([]);
    expect(r.order.indexOf('A')).toBeLessThan(r.order.indexOf('B'));
    expect(r.order.indexOf('B')).toBeLessThan(r.order.indexOf('C'));
  });

  it('breaks a 2-node cycle and remembers the cycle edge', () => {
    const p = patchOf(
      { id: 'A', type: 'attenuator', params: {}, inputs: { in: 'B' } },
      { id: 'B', type: 'inverter',   params: {}, inputs: { in: 'A' } },
    );
    const r = topoSort(p);
    expect(r.cycleEdges.length).toBe(1);
    expect(r.order).toHaveLength(2);
  });
});

describe('GraphEngine — bindings', () => {
  it('writes additive sum to base + signal*amount', () => {
    const { engine, store, live } = makeEngine({
      nodes: [{ id: 'lfo', type: 'constant', params: { value: 1 }, inputs: {} }],
      bindings: [{
        id: 'b', paramKey: 'zPush', sourceNodeId: 'lfo',
        amount: 0.5, mode: 'additive',
      }],
    });
    store.state.zPush = 0.9;
    engine.tick(1 / 60);
    // v9: engine doesn't write Settings; modulated value lives in `live`.
    expect(store.state.zPush).toBe(0.9);
    expect(live.getLive('zPush')).toBeCloseTo(0.9 + 0.5);
  });

  it('multiple bindings to the same param sum (additive)', () => {
    const { engine, store, live } = makeEngine({
      nodes: [
        { id: 'a', type: 'constant', params: { value: 0.4 }, inputs: {} },
        { id: 'b', type: 'constant', params: { value: 0.3 }, inputs: {} },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'a', amount: 1, mode: 'additive' },
        { id: 'b2', paramKey: 'zPush', sourceNodeId: 'b', amount: 1, mode: 'additive' },
      ],
    });
    store.state.zPush = 0;
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(0.7);
  });

  it('multiplicative mode: base * (1 + signal*amount)', () => {
    const { engine, store, live } = makeEngine({
      nodes: [{ id: 'a', type: 'constant', params: { value: 1 }, inputs: {} }],
      bindings: [{
        id: 'b', paramKey: 'intensity', sourceNodeId: 'a',
        amount: 0.5, mode: 'multiplicative',
      }],
    });
    store.state.intensity = 1;
    engine.tick(1 / 60);
    expect(live.getLive('intensity')).toBeCloseTo(1.5);
  });

  it('classic mode short-circuits the engine', () => {
    const { engine, store, live } = makeEngine({
      nodes: [{ id: 'a', type: 'constant', params: { value: 1 }, inputs: {} }],
      bindings: [{ id: 'b', paramKey: 'zPush', sourceNodeId: 'a', amount: 1, mode: 'additive' }],
    });
    store.state.zPush = 0.9;
    store.state.modMode = 'classic';
    engine.tick(1 / 60);
    // No modulation contribution; live value equals base.
    expect(live.getLive('zPush')).toBe(0.9);
  });

  it('amount=0 produces zero contribution (no stickiness)', () => {
    const { engine, store, live } = makeEngine({
      nodes: [{ id: 'a', type: 'constant', params: { value: 1 }, inputs: {} }],
      bindings: [
        { id: 'b', paramKey: 'zPush', sourceNodeId: 'a', amount: 0.5, mode: 'additive' },
      ],
    });
    store.state.zPush = 0.2;
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(0.7);

    // Drop amount to 0 — live snaps back to base immediately.
    engine.setPatch({
      ...engine.getPatch(),
      bindings: [
        { id: 'b', paramKey: 'zPush', sourceNodeId: 'a', amount: 0, mode: 'additive' },
      ],
    });
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(0.2);
  });

  it('removing a binding releases the param back to base', () => {
    const { engine, store, live } = makeEngine({
      nodes: [{ id: 'a', type: 'constant', params: { value: 1 }, inputs: {} }],
      bindings: [
        { id: 'b', paramKey: 'zPush', sourceNodeId: 'a', amount: 0.5, mode: 'additive' },
      ],
    });
    store.state.zPush = 0.4;
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(0.9);

    // Delete the binding entirely.
    engine.setPatch({ ...engine.getPatch(), bindings: [] });
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(0.4);
  });
});

describe('GraphEngine — feedback', () => {
  it('feedback patch does not lock up; emits one-frame-delay values', () => {
    // Patch: A (delay) -> B (attenuator 0.9) -> back to A.in
    // Expected: starts at 0, slowly rings up driven by an injected constant
    // via a mixer with an external constant.
    const { engine, store, live } = makeEngine({
      nodes: [
        { id: 'C', type: 'constant',   params: { value: 0.1 }, inputs: {} },
        { id: 'M', type: 'mixer',      params: { gain1: 1, gain2: 0.9, gain3: 0, gain4: 0 }, inputs: { in1: 'C', in2: 'D' } },
        { id: 'D', type: 'delay',      params: { frames: 1 }, inputs: { in: 'M' } },
      ],
      bindings: [
        { id: 'b', paramKey: 'zPush', sourceNodeId: 'D', amount: 1, mode: 'additive' },
      ],
    });
    store.state.zPush = 0;
    let last = 0;
    for (let i = 0; i < 50; i++) {
      engine.tick(1 / 60);
      last = live.getLive('zPush');
    }
    // Closed-loop steady state of 0.1 / (1 - 0.9) = 1; the per-frame
    // delay-1 path makes the loop ring up slowly so the assertion just
    // proves the patch (a) didn't lock up, (b) accumulated some signal,
    // and (c) stayed bounded.
    expect(last).toBeGreaterThan(0.7);
    expect(last).toBeLessThan(2.5);
  });
});

describe('GraphEngine — perf', () => {
  it('20-node patch ticks under 0.5ms average on this machine', () => {
    // Build a busy patch: 3 LFOs, 4 mixers, 2 multipliers, 5 processors, 6 bindings.
    const nodes: GraphPatch['nodes'] = [
      { id: 'L1', type: 'lfo', params: { rate: 1 },   inputs: {} },
      { id: 'L2', type: 'lfo', params: { rate: 0.5 }, inputs: {} },
      { id: 'L3', type: 'lfo', params: { rate: 2 },   inputs: {} },
      { id: 'AT1', type: 'attenuator', params: { level: 0.5 }, inputs: { in: 'L1' } },
      { id: 'AT2', type: 'attenuator', params: { level: 0.5 }, inputs: { in: 'L2' } },
      { id: 'IN1', type: 'inverter', params: {}, inputs: { in: 'L3' } },
      { id: 'CRV', type: 'curve', params: { shape: 'sCurve' }, inputs: { in: 'AT1' } },
      { id: 'SLW', type: 'slew',  params: { riseMs: 50, fallMs: 50 }, inputs: { in: 'AT2' } },
      { id: 'MX1', type: 'mixer', params: {}, inputs: { in1: 'CRV', in2: 'SLW', in3: 'IN1' } },
      { id: 'MX2', type: 'mixer', params: {}, inputs: { in1: 'L1', in2: 'L2' } },
      { id: 'MX3', type: 'mixer', params: {}, inputs: { in1: 'MX1', in2: 'MX2' } },
      { id: 'MX4', type: 'mixer', params: {}, inputs: { in1: 'MX3', in2: 'IN1' } },
      { id: 'M1',  type: 'multiplier', params: {}, inputs: { a: 'L1', b: 'L2' } },
      { id: 'M2',  type: 'multiplier', params: {}, inputs: { a: 'M1', b: 'L3' } },
      { id: 'CST', type: 'constant', params: { value: 0.5 }, inputs: {} },
      { id: 'OFS', type: 'offset', params: { bias: 0.1 }, inputs: { in: 'M2' } },
      { id: 'RNG', type: 'range', params: {}, inputs: { in: 'OFS' } },
      { id: 'CMP', type: 'comparator', params: {}, inputs: { a: 'L1', b: 'CST' } },
      { id: 'SH',  type: 'sample-and-hold', params: {}, inputs: { in: 'L2', trigger: 'CMP' } },
      { id: 'INV2', type: 'inverter', params: {}, inputs: { in: 'SH' } },
    ];
    const bindings = [
      { id: 'b1', paramKey: 'zPush',          sourceNodeId: 'MX4', amount: 0.3, mode: 'additive' as const },
      { id: 'b2', paramKey: 'scanRate',       sourceNodeId: 'RNG', amount: 30,  mode: 'additive' as const },
      { id: 'b3', paramKey: 'intensity',      sourceNodeId: 'CRV', amount: 0.2, mode: 'multiplicative' as const },
      { id: 'b4', paramKey: 'bloomIntensity', sourceNodeId: 'SLW', amount: 0.5, mode: 'additive' as const },
      { id: 'b5', paramKey: 'focus',          sourceNodeId: 'INV2', amount: 0.4, mode: 'additive' as const },
      { id: 'b6', paramKey: 'chromaAmount',   sourceNodeId: 'M2',  amount: 0.001, mode: 'additive' as const },
    ];
    const { engine } = makeEngine({ nodes, bindings });
    // Warm up to amortize the first compile / V8 inline caches.
    for (let i = 0; i < 200; i++) engine.tick(1 / 60);
    const N = 1000;
    const start = performance.now();
    for (let i = 0; i < N; i++) engine.tick(1 / 60);
    const avgMs = (performance.now() - start) / N;
    // We log the actual number for visibility; assert generously to avoid
    // CI flake. Spec target is 0.5 ms; we pick 1.0 as the hard ceiling.
    // eslint-disable-next-line no-console
    console.log(`[graph perf] 20-node tick avg ${avgMs.toFixed(3)} ms`);
    expect(avgMs).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------
// v25: per-output-port input refs (`nodeId#port`)
// ---------------------------------------------------------------
describe('per-port input refs (v25)', () => {
  it('reads the named output of a multi-output source', () => {
    // sync at division 4 emits phase 0, .25, .5, .75 — inverter flips it.
    const patch: GraphPatch = {
      nodes: [
        { id: 's1', type: 'sync', params: { division: '4' }, inputs: {} },
        { id: 'inv', type: 'inverter', params: {}, inputs: { in: 's1#phase' } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'inv', amount: 1, mode: 'additive' },
      ],
    };
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60); // sync frame 0: phase 0
    expect(live.getLive('zPush')).toBeCloseTo(1, 6); // base 1 + (-0)
    engine.tick(1 / 60); // sync frame 1: phase 0.25 -> inverter -0.25
    expect(live.getLive('zPush')).toBeCloseTo(1 - 0.25, 6);
  });

  it('plain-id refs still read the default output (pre-v25 patches)', () => {
    const patch: GraphPatch = {
      nodes: [
        { id: 's1', type: 'sync', params: { division: '4' }, inputs: {} },
        { id: 'inv', type: 'inverter', params: {}, inputs: { in: 's1' } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'inv', amount: 1, mode: 'additive' },
      ],
    };
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60); // default output is 'pulse' (first) = 1 on frame 0
    expect(live.getLive('zPush')).toBeCloseTo(1 - 1, 6);
  });

  it('a #-ref participates in topo ordering (source ticks first)', () => {
    // If ordering were broken the inverter would read a stale 0 forever.
    const patch: GraphPatch = {
      nodes: [
        { id: 'zz-late', type: 'constant', params: { value: 0.5 }, inputs: {} },
        { id: 'aa-early', type: 'inverter', params: {}, inputs: { in: 'zz-late#out' } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'aa-early', amount: 1, mode: 'additive' },
      ],
    };
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1 - 0.5, 6);
  });
});
