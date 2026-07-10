import { describe, it, expect } from 'vitest';
import { lanesForKey, diamondState, planToggle } from '../keyframeState';
import { evalLane, laneOffsets, upsertPoint } from '../../sequencer/lanes';
import { AutomationLane } from '../../sequencer/types';

const lane = (
  id: string,
  paramKey: string,
  points: Array<[number, number]>,
  enabled = true,
): AutomationLane => ({
  id,
  paramKey,
  enabled,
  points: points.map(([bar, value]) => ({ bar, value })),
});

describe('lanesForKey / diamondState', () => {
  const lanes = [
    lane('a', 'zPush', [[0, 0.5], [4, 1]]),
    lane('b', 'bloomIntensity', [[2, -1]]),
  ];

  it('filters lanes by param', () => {
    expect(lanesForKey(lanes, 'zPush').map((l) => l.id)).toEqual(['a']);
    expect(lanesForKey(lanes, 'nothing')).toEqual([]);
  });

  it('reports none / lane / point', () => {
    expect(diamondState([], 2)).toBe('none');
    expect(diamondState(lanesForKey(lanes, 'zPush'), 2)).toBe('lane');
    expect(diamondState(lanesForKey(lanes, 'zPush'), 4)).toBe('point');
  });

  it('tolerates float playheads at a point', () => {
    expect(diamondState(lanesForKey(lanes, 'zPush'), 4 + 1e-9)).toBe('point');
  });

  it('reports point if ANY lane for the key has one at the head', () => {
    const multi = [lane('a', 'zPush', [[0, 0]]), lane('c', 'zPush', [[2, 1]])];
    expect(diamondState(multi, 2)).toBe('point');
  });
});

describe('planToggle', () => {
  it('creates a lane with a 0-offset point when none exists', () => {
    const plan = planToggle([], 3);
    expect(plan).toEqual({ kind: 'createLane', point: { bar: 3, value: 0 } });
  });

  it('add-point pins the evaluated curve value — live value never jumps', () => {
    const l = lane('a', 'zPush', [[0, 0], [8, 2]]);
    l.points[1].easing = 'easeInOut';
    const head = 3.3;
    const before = laneOffsets([l], head).get('zPush') ?? 0;

    const plan = planToggle([l], head);
    expect(plan.kind).toBe('addPoint');
    if (plan.kind !== 'addPoint') return;
    expect(plan.point.value).toBeCloseTo(evalLane(l.points, head));

    // Applying the plan leaves the offset at the head unchanged.
    l.points = upsertPoint(l.points, plan.point);
    const after = laneOffsets([l], head).get('zPush') ?? 0;
    expect(after).toBeCloseTo(before);
  });

  it('removes by the exact stored bar given a float playhead', () => {
    const l = lane('a', 'zPush', [[4, 1]]);
    const plan = planToggle([l], 3.9999999999);
    expect(plan).toEqual({ kind: 'removePoint', laneId: 'a', bar: 4 });
  });

  it('with multiple lanes, remove wins over add and add targets the first lane', () => {
    const first = lane('first', 'zPush', [[0, 0.5]]);
    const second = lane('second', 'zPush', [[2, 1]]);

    // Point at head on the SECOND lane → removal targets that lane.
    const removal = planToggle([first, second], 2);
    expect(removal).toEqual({ kind: 'removePoint', laneId: 'second', bar: 2 });

    // No point at head anywhere → add on the FIRST lane.
    const add = planToggle([first, second], 5);
    expect(add.kind).toBe('addPoint');
    if (add.kind === 'addPoint') expect(add.laneId).toBe('first');
  });
});
