/**
 * Pure cable-model helpers for the rack skin. The invariant these
 * protect: cable edits are ordinary patch-data edits (modSlots.target),
 * never live-value writes.
 */
import { describe, it, expect } from 'vitest';
import {
  classicCables, graphCables, applyCableTarget, applyCableSource,
  slotForParam, nearestJack, rectCenter,
  graphBindingForParam, applyGraphBindingTarget,
  nodeWires, applyNodeInputRef, deleteGraphNode,
  ensureParamOutNode, bindParamOut, paramOutKeyOf, genGraphId,
} from '../rackGeometry';
import { cableControlPoints } from '../../cableDraw';
import type { ModSlot } from '../../../state/Settings';
import type { GraphPatch } from '../../../modulation/graph/types';

function slot(over: Partial<ModSlot>): ModSlot {
  return {
    enabled: false, source: 'sine', target: 'none', amount: 0.5,
    frequency: 1, freqRange: 'mid', phase: 0, duty: 0.5, rampTimeSec: 1,
    ...over,
  } as ModSlot;
}

describe('classicCables', () => {
  it('emits one cable per slot with a real target, keeping slot index', () => {
    const slots = [slot({}), slot({ target: 'zPush', enabled: true }), slot({ target: 'focus' })];
    expect(classicCables(slots)).toEqual([
      { slotIndex: 1, target: 'zPush', enabled: true },
      { slotIndex: 2, target: 'focus', enabled: false },
    ]);
  });
});

describe('graphCables', () => {
  it('handles null patch and missing enabled flags (default true)', () => {
    expect(graphCables(null)).toEqual([]);
    const patch = {
      nodes: [],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
        { id: 'b2', paramKey: 'focus', sourceNodeId: 'n1', amount: 1, mode: 'additive', enabled: false },
      ],
    } as unknown as GraphPatch;
    expect(graphCables(patch)).toEqual([
      { bindingId: 'b1', paramKey: 'zPush', enabled: true, sourceNodeId: 'n1', sourcePort: undefined },
      { bindingId: 'b2', paramKey: 'focus', enabled: false, sourceNodeId: 'n1', sourcePort: undefined },
    ]);
  });
  it('passes through sourcePort for multi-output nodes (e.g. Sync phase/pulse)', () => {
    const patch = {
      nodes: [],
      bindings: [
        { id: 'b1', paramKey: 'hSpin', sourceNodeId: 'sync1', sourcePort: 'phase', amount: 1, mode: 'additive' },
      ],
    } as unknown as GraphPatch;
    expect(graphCables(patch)[0]).toMatchObject({ sourceNodeId: 'sync1', sourcePort: 'phase' });
  });
});

describe('graphBindingForParam', () => {
  it('returns the LAST binding targeting the param, or null', () => {
    const patch = {
      nodes: [],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
        { id: 'b2', paramKey: 'focus', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
        { id: 'b3', paramKey: 'zPush', sourceNodeId: 'n2', amount: 1, mode: 'additive' },
      ],
    } as unknown as GraphPatch;
    expect(graphBindingForParam(patch, 'zPush')).toBe('b3');
    expect(graphBindingForParam(patch, 'hSize')).toBeNull();
  });
  it('ignores unplugged (paramKey "none") bindings and a null patch', () => {
    expect(graphBindingForParam(null, 'zPush')).toBeNull();
    const patch = {
      nodes: [],
      bindings: [{ id: 'b1', paramKey: 'none', sourceNodeId: 'n1', amount: 1, mode: 'additive' }],
    } as unknown as GraphPatch;
    expect(graphBindingForParam(patch, 'none')).toBeNull();
  });
});

describe('applyGraphBindingTarget', () => {
  it('re-targets the matching binding by id, leaving others and nodes untouched', () => {
    const patch = {
      nodes: [{ id: 'n1' }],
      bindings: [
        { id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
        { id: 'b2', paramKey: 'focus', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
      ],
    } as unknown as GraphPatch;
    const next = applyGraphBindingTarget(patch, 'b1', 'hSize');
    expect(next.bindings[0].paramKey).toBe('hSize');
    expect(next.bindings[1]).toBe(patch.bindings[1]); // untouched binding is the same object
    expect(next.nodes).toBe(patch.nodes);             // nodes untouched
    expect(patch.bindings[0].paramKey).toBe('zPush');  // input not mutated
  });

  it('"none" unplugs without deleting the binding', () => {
    const patch = {
      nodes: [],
      bindings: [{ id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 1, mode: 'additive' }],
    } as unknown as GraphPatch;
    const next = applyGraphBindingTarget(patch, 'b1', 'none');
    expect(next.bindings).toHaveLength(1);
    expect(next.bindings[0].paramKey).toBe('none');
  });
});

describe('nodeWires', () => {
  it('resolves each wired input via splitInputRef, defaulting sourcePort to \'\'', () => {
    const patch = {
      nodes: [
        { id: 'a', type: 'sync', inputs: {}, params: {} },
        { id: 'b', type: 'noise', inputs: { clock: 'a#pulse' }, params: {} },
        { id: 'c', type: 'ramp', inputs: { trigger: 'a' }, params: {} },
      ],
      bindings: [],
    } as unknown as GraphPatch;
    expect(nodeWires(patch)).toEqual([
      { targetNodeId: 'b', targetPort: 'clock', sourceNodeId: 'a', sourcePort: 'pulse' },
      { targetNodeId: 'c', targetPort: 'trigger', sourceNodeId: 'a', sourcePort: '' },
    ]);
  });
  it('skips null/missing refs and handles a null patch', () => {
    expect(nodeWires(null)).toEqual([]);
    const patch = {
      nodes: [{ id: 'a', type: 'ramp', inputs: { trigger: null }, params: {} }],
      bindings: [],
    } as unknown as GraphPatch;
    expect(nodeWires(patch)).toEqual([]);
  });
});

describe('applyNodeInputRef', () => {
  it('wires a port by id, leaving other nodes/inputs untouched', () => {
    const patch = {
      nodes: [
        { id: 'a', type: 'sync', inputs: {}, params: {} },
        { id: 'b', type: 'noise', inputs: {}, params: {} },
      ],
      bindings: [],
    } as unknown as GraphPatch;
    const next = applyNodeInputRef(patch, 'b', 'clock', 'a#pulse');
    expect(next.nodes[1].inputs).toEqual({ clock: 'a#pulse' });
    expect(next.nodes[0]).toBe(patch.nodes[0]); // untouched node is the same object
    expect(patch.nodes[1].inputs).toEqual({}); // input not mutated
  });
  it('null unplugs the port', () => {
    const patch = {
      nodes: [{ id: 'b', type: 'noise', inputs: { clock: 'a#pulse' }, params: {} }],
      bindings: [],
    } as unknown as GraphPatch;
    const next = applyNodeInputRef(patch, 'b', 'clock', null);
    expect(next.nodes[0].inputs).toEqual({ clock: null });
  });
});

describe('deleteGraphNode', () => {
  it('removes the node, unwires other nodes\' inputs from it, and drops its bindings', () => {
    const patch = {
      nodes: [
        { id: 'a', type: 'sync', inputs: {}, params: {} },
        { id: 'b', type: 'noise', inputs: { clock: 'a#pulse' }, params: {} },
        { id: 'c', type: 'ramp', inputs: { trigger: 'a' }, params: {} },
      ],
      bindings: [
        { id: 'bind1', paramKey: 'zPush', sourceNodeId: 'a', amount: 1, mode: 'additive' },
        { id: 'bind2', paramKey: 'focus', sourceNodeId: 'b', amount: 1, mode: 'additive' },
      ],
    } as unknown as GraphPatch;
    const next = deleteGraphNode(patch, 'a');
    expect(next.nodes.map((n) => n.id)).toEqual(['b', 'c']);
    expect(next.nodes[0].inputs).toEqual({ clock: null }); // was wired to a#pulse
    expect(next.nodes[1].inputs).toEqual({ trigger: null }); // was wired to a
    expect(next.bindings).toEqual([{ id: 'bind2', paramKey: 'focus', sourceNodeId: 'b', amount: 1, mode: 'additive' }]);
  });

  it('leaves nodes with no reference to the deleted node untouched (same object)', () => {
    const patch = {
      nodes: [
        { id: 'a', type: 'sync', inputs: {}, params: {} },
        { id: 'b', type: 'noise', inputs: {}, params: {} },
      ],
      bindings: [],
    } as unknown as GraphPatch;
    const next = deleteGraphNode(patch, 'a');
    expect(next.nodes).toEqual([patch.nodes[1]]);
    expect(next.nodes[0]).toBe(patch.nodes[1]); // untouched node is the same object
  });

  it('deleting an unrelated node leaves bindings/wires untouched', () => {
    const patch = {
      nodes: [
        { id: 'a', type: 'sync', inputs: {}, params: {} },
        { id: 'b', type: 'noise', inputs: { clock: 'a#pulse' }, params: {} },
      ],
      bindings: [{ id: 'bind1', paramKey: 'zPush', sourceNodeId: 'a', amount: 1, mode: 'additive' }],
    } as unknown as GraphPatch;
    const next = deleteGraphNode(patch, 'b');
    expect(next.nodes).toEqual([patch.nodes[0]]);
    expect(next.bindings).toEqual(patch.bindings);
  });
});

describe('applyCableTarget', () => {
  it('plugging sets the target AND enables the slot', () => {
    const slots = [slot({}), slot({})];
    const next = applyCableTarget(slots, 1, 'zPush');
    expect(next[1].target).toBe('zPush');
    expect(next[1].enabled).toBe(true);
    expect(next[0]).toBe(slots[0]);      // untouched slots are the same object
    expect(next).not.toBe(slots);        // array replaced wholesale
    expect(slots[1].target).toBe('none'); // input not mutated
  });

  it('unplugging sets none and leaves enabled alone', () => {
    const slots = [slot({ target: 'zPush', enabled: true })];
    const next = applyCableTarget(slots, 0, 'none');
    expect(next[0].target).toBe('none');
    expect(next[0].enabled).toBe(true);
  });
});

describe('applyCableSource', () => {
  it('plugging a source sets it AND enables the slot (patch bay SRC IN)', () => {
    const slots = [slot({ source: 'sine' })];
    const next = applyCableSource(slots, 0, 'audio');
    expect(next[0].source).toBe('audio');
    expect(next[0].enabled).toBe(true);
    expect(slots[0].source).toBe('sine'); // input untouched
  });
});

describe('slotForParam', () => {
  it('returns the LAST slot plugged into the param, or -1', () => {
    const slots = [slot({ target: 'zPush' }), slot({}), slot({ target: 'zPush' })];
    expect(slotForParam(slots, 'zPush')).toBe(2);
    expect(slotForParam(slots, 'focus')).toBe(-1);
  });
});

describe('nearestJack', () => {
  const jacks = [
    { key: 'a', x: 0, y: 0 },
    { key: 'b', x: 10, y: 0 },
  ];
  it('picks the closest within range, ties broken by later entry (<=)', () => {
    expect(nearestJack(jacks, { x: 3, y: 0 }, 28)?.key).toBe('a');
    expect(nearestJack(jacks, { x: 8, y: 0 }, 28)?.key).toBe('b');
  });
  it('returns null beyond the snap radius', () => {
    expect(nearestJack(jacks, { x: 100, y: 100 }, 28)).toBeNull();
  });
});

describe('rectCenter', () => {
  it('centers a rect', () => {
    expect(rectCenter({ left: 10, top: 20, width: 4, height: 8 })).toEqual({ x: 12, y: 24 });
  });
});

describe('cableControlPoints', () => {
  it('flow style pushes control points outward in X (min 40px)', () => {
    const [c1, c2] = cableControlPoints({ x: 0, y: 0 }, { x: 20, y: 50 }, 'flow');
    expect(c1).toEqual({ x: 40, y: 0 });
    expect(c2).toEqual({ x: -20, y: 50 });
  });
  it('flow style scales with horizontal distance', () => {
    const [c1] = cableControlPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 'flow');
    expect(c1.x).toBe(100);
  });
  it('sag style hangs both control points below the endpoints', () => {
    const [c1, c2] = cableControlPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 'sag');
    expect(c1.x).toBe(0);
    expect(c2.x).toBe(100);
    expect(c1.y).toBeGreaterThan(0);
    expect(c2.y).toBeGreaterThan(0);
    expect(c1.y).toBe(c2.y);
  });
  it('sag is capped for very long cables', () => {
    const [c1] = cableControlPoints({ x: 0, y: 0 }, { x: 10000, y: 0 }, 'sag');
    expect(c1.y).toBe(140);
  });
  it('sag billows sideways when both ends share nearly the same x — otherwise a straight vertical line through several stacked jacks is indistinguishable from any one of them (rack/Patch Bay bug)', () => {
    const [c1, c2] = cableControlPoints({ x: 40, y: 0 }, { x: 33, y: 400 }, 'sag');
    expect(c1.x).toBeGreaterThan(40);
    expect(c2.x).toBeGreaterThan(33);
    // Both control points billow by the same amount, so the belly stays
    // a smooth, single-direction curve rather than a lopsided kink.
    expect(c1.x - 40).toBeCloseTo(c2.x - 33, 5);
  });
  it('sag never overshoots past a mostly-vertical cable\'s own endpoint — a naive "+sag on both ends" hooks the curve well past whichever end sits lower, which reads as "the cable doesn\'t connect to its jack" even though the true endpoint is mathematically exact', () => {
    const a = { x: 40, y: 0 }, b = { x: 33, y: 600 }; // b well below a, nearly vertical
    const [c1, c2] = cableControlPoints(a, b, 'sag');
    expect(c1.y).toBeLessThanOrEqual(b.y); // c1's droop must not reach past b
    expect(c2.y).toBeLessThanOrEqual(b.y); // c2 must approach b from ABOVE, not overshoot below it
    expect(c1.y).toBeGreaterThanOrEqual(a.y); // and never above a, the other direction
  });
  it('sag keeps the original hammock shape for a level (non-vertical) cable regardless of length', () => {
    const [c1, c2] = cableControlPoints({ x: 0, y: 100 }, { x: 300, y: 100 }, 'sag');
    expect(c1.y).toBeGreaterThan(100);
    expect(c2.y).toBeGreaterThan(100);
    expect(c1.y).toBe(c2.y); // symmetric hang, unaffected by the vertical-case fix
  });
});

describe('param → param patching (shared by Patch Bay and the rack Controls panel)', () => {
  let n = 0;
  const gen = (prefix: string): string => `${prefix}${++n}`;

  it('creates a param-out node and a binding to the target', () => {
    const out = bindParamOut(null, 'zPush', 'hSize', gen);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({ type: 'param-out', params: { key: 'zPush' } });
    expect(out.bindings).toHaveLength(1);
    expect(out.bindings[0]).toMatchObject({ paramKey: 'hSize', sourceNodeId: out.nodes[0].id });
    expect(paramOutKeyOf(out, out.nodes[0].id)).toBe('zPush');
  });

  it('reuses the same param-out node for a second target, and is idempotent', () => {
    const a = bindParamOut(null, 'zPush', 'hSize', gen);
    const b = bindParamOut(a, 'zPush', 'vSize', gen);
    expect(b.nodes).toHaveLength(1);
    expect(b.bindings.map((x) => x.paramKey)).toEqual(['hSize', 'vSize']);
    expect(bindParamOut(b, 'zPush', 'vSize', gen)).toBe(b);
  });

  it('refuses a param feeding itself', () => {
    const empty = { nodes: [], bindings: [] };
    expect(bindParamOut(empty, 'zPush', 'zPush', gen)).toBe(empty);
  });

  it('ensureParamOutNode leaves an existing node alone', () => {
    const a = bindParamOut(null, 'zPush', 'hSize', gen);
    const r = ensureParamOutNode(a, 'zPush', gen);
    expect(r.patch).toBe(a);
    expect(r.nodeId).toBe(a.nodes[0].id);
  });

  it('paramOutKeyOf is null for other node types; ids never contain #', () => {
    expect(paramOutKeyOf({ nodes: [{ id: 'x', type: 'lfo', params: {}, inputs: {} }], bindings: [] }, 'x')).toBeNull();
    expect(genGraphId('n')).not.toContain('#');
  });
});
