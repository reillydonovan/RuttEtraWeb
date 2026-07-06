/**
 * v17: per-node / per-binding enable flags (AUDIT item 23).
 *
 * Semantics under test:
 *  - node.enabled === false → tick skipped, all outputs read 0 downstream
 *  - binding.enabled === false → contributes nothing; target snaps to base
 *  - missing `enabled` (pre-v17 patches) → treated as enabled
 *  - getActiveTargets() excludes disabled bindings
 */
import { describe, it, expect } from 'vitest';
import { GraphPatch } from '../types';
import { makeEngine } from './helpers';

function constantPatch(overrides: {
  nodeEnabled?: boolean;
  bindingEnabled?: boolean;
} = {}): GraphPatch {
  return {
    nodes: [
      {
        id: 'c1', type: 'constant', params: { value: 0.5 }, inputs: {},
        ...(overrides.nodeEnabled !== undefined ? { enabled: overrides.nodeEnabled } : {}),
      },
    ],
    bindings: [
      {
        id: 'b1', paramKey: 'zPush', sourceNodeId: 'c1', amount: 1, mode: 'additive',
        ...(overrides.bindingEnabled !== undefined ? { enabled: overrides.bindingEnabled } : {}),
      },
    ],
  };
}

describe('graph enabled flags (v17)', () => {
  it('missing enabled field behaves as enabled (pre-v17 compat)', () => {
    const { engine, live } = makeEngine(constantPatch());
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1 + 0.5, 6); // base 1 + 0.5
  });

  it('disabled node outputs 0 downstream', () => {
    const { engine, live } = makeEngine(constantPatch({ nodeEnabled: false }));
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1, 6); // base only
  });

  it('disabled node feeding a processor silences the whole chain', () => {
    const patch: GraphPatch = {
      nodes: [
        { id: 'c1', type: 'constant', params: { value: 1 }, inputs: {}, enabled: false },
        { id: 'inv', type: 'inverter', params: {}, inputs: { in: 'c1' } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'inv', amount: 1, mode: 'additive' },
      ],
    };
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60);
    // inverter of 0 is 0 (or -0) — chain contributes nothing.
    expect(live.getLive('zPush')).toBeCloseTo(1, 6);
  });

  it('re-enabling a node resumes contribution the same frame', () => {
    const patch = constantPatch({ nodeEnabled: false });
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1, 6);
    // Mutate + re-set the patch (mirrors how the inspector persists edits).
    patch.nodes[0].enabled = true;
    engine.setPatch(patch);
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1.5, 6);
  });

  it('disabled binding contributes nothing and clears instantly', () => {
    const patch = constantPatch();
    const { engine, live } = makeEngine(patch);
    engine.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(1.5, 6);
    patch.bindings[0].enabled = false;
    engine.setPatch(patch);
    engine.tick(1 / 60);
    // Same-frame setContributions clear — no stickiness.
    expect(live.getLive('zPush')).toBeCloseTo(1, 6);
  });

  it('getActiveTargets excludes disabled bindings', () => {
    const { engine } = makeEngine(constantPatch({ bindingEnabled: false }));
    expect(engine.getActiveTargets().has('zPush')).toBe(false);
    const { engine: engine2 } = makeEngine(constantPatch());
    expect(engine2.getActiveTargets().has('zPush')).toBe(true);
  });
});
