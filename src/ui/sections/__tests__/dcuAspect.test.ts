// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { aspectForSource } from '../DcuSection';

describe('aspectForSource (DCU ▸ Match source)', () => {
  it('returns width / height for a real picture', () => {
    expect(aspectForSource(1920, 1080)).toBeCloseTo(16 / 9, 3);
    expect(aspectForSource(640, 480)).toBeCloseTo(4 / 3, 3);
  });
  it('clamps to the Aspect slider range', () => {
    expect(aspectForSource(5000, 100)).toBe(4);
    expect(aspectForSource(100, 5000)).toBe(0.25);
  });
  it('is null with no picture yet', () => {
    expect(aspectForSource(0, 0)).toBeNull();
    expect(aspectForSource(640, 0)).toBeNull();
  });
});
