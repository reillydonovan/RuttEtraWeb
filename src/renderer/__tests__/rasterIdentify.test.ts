import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetRasterIdentifyForTests,
  isIdentifyEffective,
  isIdentifyRequested,
  setIdentifyRequested,
  setOutputActive,
  subscribeIdentify,
} from '../rasterIdentify';

describe('rasterIdentify', () => {
  beforeEach(() => __resetRasterIdentifyForTests());

  it('starts off', () => {
    expect(isIdentifyRequested()).toBe(false);
    expect(isIdentifyEffective()).toBe(false);
  });

  it('is effective when requested and no output is active', () => {
    setIdentifyRequested(true);
    expect(isIdentifyEffective()).toBe(true);
  });

  it('any active output suppresses the tint, without clearing the request', () => {
    setIdentifyRequested(true);
    setOutputActive('recorder', true);
    expect(isIdentifyEffective()).toBe(false);
    expect(isIdentifyRequested()).toBe(true);
    setOutputActive('recorder', false);
    expect(isIdentifyEffective()).toBe(true);
  });

  it('tracks overlapping outputs independently', () => {
    setIdentifyRequested(true);
    setOutputActive('recorder', true);
    setOutputActive('whip', true);
    setOutputActive('recorder', false);
    expect(isIdentifyEffective()).toBe(false);
    setOutputActive('whip', false);
    expect(isIdentifyEffective()).toBe(true);
  });

  it('notifies subscribers only when the effective value flips', () => {
    const seen: boolean[] = [];
    subscribeIdentify((v) => seen.push(v));
    setIdentifyRequested(true);
    setOutputActive('xr', true);
    setOutputActive('xr', true); // duplicate — no change
    setOutputActive('xr', false);
    expect(seen).toEqual([false, true, false, true]);
  });

  it('an output starting while the toggle is off never turns the tint on', () => {
    setOutputActive('broadcast', true);
    setOutputActive('broadcast', false);
    expect(isIdentifyEffective()).toBe(false);
  });
});
