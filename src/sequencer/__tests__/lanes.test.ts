/**
 * Keyframing v2 data layer — automation-lane evaluation (AUDIT item 25).
 */
import { describe, it, expect } from 'vitest';
import { evalLane, laneOffsets, upsertPoint, removePointAt } from '../lanes';
import { AutomationLane, AutomationPoint } from '../types';

const PTS: AutomationPoint[] = [
  { bar: 2, value: 0 },
  { bar: 4, value: 1 },
  { bar: 8, value: -1 },
];

describe('evalLane', () => {
  it('returns 0 for an empty lane', () => {
    expect(evalLane([], 3)).toBe(0);
  });

  it('clamp-holds outside the point range', () => {
    expect(evalLane(PTS, 0)).toBe(0);     // before first → first value
    expect(evalLane(PTS, 100)).toBe(-1);  // after last → last value
  });

  it('interpolates linearly between points by default', () => {
    expect(evalLane(PTS, 3)).toBeCloseTo(0.5, 6);
    expect(evalLane(PTS, 6)).toBeCloseTo(0, 6); // halfway from 1 to -1
  });

  it('honors the incoming point easing (hold = stay on previous value)', () => {
    const pts: AutomationPoint[] = [
      { bar: 0, value: 0 },
      { bar: 4, value: 1, easing: 'hold' },
    ];
    expect(evalLane(pts, 2)).toBe(0);   // held at previous
    expect(evalLane(pts, 4)).toBe(1);   // jumps at the point
  });

  it('hits points exactly at their bars', () => {
    expect(evalLane(PTS, 4)).toBe(1);
    expect(evalLane(PTS, 8)).toBe(-1);
  });
});

describe('laneOffsets', () => {
  const lane = (over: Partial<AutomationLane>): AutomationLane => ({
    id: 'l1', paramKey: 'zPush', enabled: true, points: PTS, ...over,
  });

  it('skips disabled and empty lanes', () => {
    expect(laneOffsets([lane({ enabled: false })], 4).size).toBe(0);
    expect(laneOffsets([lane({ points: [] })], 4).size).toBe(0);
  });

  it('sums multiple lanes on the same param', () => {
    const m = laneOffsets([lane({}), lane({ id: 'l2' })], 4);
    expect(m.get('zPush')).toBeCloseTo(2, 6);
  });

  it('keeps distinct params separate', () => {
    const m = laneOffsets([lane({}), lane({ id: 'l2', paramKey: 'intensity' })], 4);
    expect(m.get('zPush')).toBeCloseTo(1, 6);
    expect(m.get('intensity')).toBeCloseTo(1, 6);
  });
});

describe('point editing helpers', () => {
  it('upsertPoint inserts sorted and replaces exact-bar matches', () => {
    let pts = upsertPoint(PTS, { bar: 3, value: 5 });
    expect(pts.map((p) => p.bar)).toEqual([2, 3, 4, 8]);
    pts = upsertPoint(pts, { bar: 3, value: 7 });
    expect(pts.filter((p) => p.bar === 3)).toHaveLength(1);
    expect(pts.find((p) => p.bar === 3)?.value).toBe(7);
    // Original array untouched (pure).
    expect(PTS).toHaveLength(3);
  });

  it('removePointAt removes only the exact bar', () => {
    const pts = removePointAt(PTS, 4);
    expect(pts.map((p) => p.bar)).toEqual([2, 8]);
    expect(removePointAt(PTS, 99)).toHaveLength(3);
  });
});
