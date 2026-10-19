import { describe, expect, it } from 'vitest';
import { nowMs, random, seededRandom, useOfflineDeterminism } from '../determinism';

describe('determinism', () => {
  it('a seed always gives the same sequence, and another seed a different one', () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
    const sa = Array.from({ length: 8 }, a), sb = Array.from({ length: 8 }, b), sc = Array.from({ length: 8 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });

  it('is live time and Math.random until offline mode is installed, then the render clock and the seed', () => {
    const before = nowMs();
    expect(Math.abs(before - performance.now())).toBeLessThan(50);
    let renderMs = 0;
    useOfflineDeterminism(() => renderMs, 7);
    expect(nowMs()).toBe(0);
    renderMs = 1000 / 30 * 45;
    expect(nowMs()).toBe(1500);
    const expected = seededRandom(7);
    expect([random(), random(), random()]).toEqual([expected(), expected(), expected()]);
  });
});
