/**
 * Pure cable geometry — control points and the click/hover hit-test.
 */
import { describe, it, expect } from 'vitest';
import { cableControlPoints, distanceToCable } from '../cableDraw';

function pointOnCubic(a: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
  };
}

describe('distanceToCable', () => {
  it('is ~0 for a point sampled from the curve itself (flow style)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 40 };
    const [c1, c2] = cableControlPoints(a, b, 'flow');
    const p = pointOnCubic(a, c1, c2, b, 0.5);
    expect(distanceToCable(p, a, b, 'flow')).toBeLessThan(1);
  });

  it('is ~0 for a point sampled from the curve itself (sag style)', () => {
    const a = { x: 10, y: 10 };
    const b = { x: 60, y: 300 };
    const [c1, c2] = cableControlPoints(a, b, 'sag');
    const p = pointOnCubic(a, c1, c2, b, 0.35);
    expect(distanceToCable(p, a, b, 'sag')).toBeLessThan(1);
  });

  it('is large for a point far from the curve', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const farPoint = { x: 100, y: 500 };
    expect(distanceToCable(farPoint, a, b, 'flow')).toBeGreaterThan(400);
  });

  it('returns 0 at the endpoints themselves', () => {
    const a = { x: 5, y: 5 };
    const b = { x: 95, y: 45 };
    expect(distanceToCable(a, a, b, 'sag')).toBeLessThan(1);
    expect(distanceToCable(b, a, b, 'sag')).toBeLessThan(1);
  });
});
