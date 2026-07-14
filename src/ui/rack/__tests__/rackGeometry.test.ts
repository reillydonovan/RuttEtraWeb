/**
 * Pure cable-model helpers for the rack skin. The invariant these
 * protect: cable edits are ordinary patch-data edits (modSlots.target),
 * never live-value writes.
 */
import { describe, it, expect } from 'vitest';
import {
  classicCables, graphCables, applyCableTarget, applyCableSource,
  slotForParam, nearestJack, rectCenter,
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
