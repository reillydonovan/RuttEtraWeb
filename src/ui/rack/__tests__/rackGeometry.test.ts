/**
 * Pure cable-model helpers for the rack skin. The invariant these
 * protect: cable edits are ordinary patch-data edits (modSlots.target),
 * never live-value writes.
 */
import { describe, it, expect } from 'vitest';
import {
  classicCables, graphCables, applyCableTarget, slotForParam, nearestJack, rectCenter,
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
      { bindingId: 'b1', paramKey: 'zPush', enabled: true },
      { bindingId: 'b2', paramKey: 'focus', enabled: false },
    ]);
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
});
