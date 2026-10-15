import { describe, expect, it } from 'vitest';
import { clonePatch } from '../clonePatch';
import type { GraphPatch } from '../types';

const patch = (): GraphPatch => ({
  nodes: [
    { id: 'a', type: 'lfo', params: { rate: 2 }, inputs: {}, position: { x: 1, y: 2 }, enabled: false },
    { id: 'b', type: 'sample-and-hold', params: {}, inputs: { in: 'a', trigger: null } },
  ],
  bindings: [{ id: 'k', paramKey: 'zPush', sourceNodeId: 'b', amount: 0.5, enabled: false } as GraphPatch['bindings'][number]],
});

describe('clonePatch', () => {
  it('returns a new object graph (no shared nodes, params, inputs, positions, bindings)', () => {
    const p = patch();
    const c = clonePatch(p);
    expect(c).not.toBe(p);
    expect(c.nodes[0]).not.toBe(p.nodes[0]);
    expect(c.nodes[0].params).not.toBe(p.nodes[0].params);
    expect(c.nodes[1].inputs).not.toBe(p.nodes[1].inputs);
    expect(c.nodes[0].position).not.toBe(p.nodes[0].position);
    expect(c.bindings[0]).not.toBe(p.bindings[0]);
    c.nodes.push({ id: 'z', type: 'noise', params: {}, inputs: {} });
    c.nodes[0].params.rate = 9;
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes[0].params.rate).toBe(2);
  });

  it('keeps every field, including the mute flags', () => {
    const p = patch();
    expect(clonePatch(p)).toEqual(p);
    expect(clonePatch(p).nodes[0].enabled).toBe(false);
    expect(clonePatch(p).bindings[0].enabled).toBe(false);
  });
});
