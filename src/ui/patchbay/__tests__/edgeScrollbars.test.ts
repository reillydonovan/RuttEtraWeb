import { describe, it, expect } from 'vitest';
import { thumbGeometry, scrollForThumb } from '../edgeScrollbars';

describe('edgeScrollbars geometry', () => {
  it('is null when the content fits', () => {
    expect(thumbGeometry(500, 500, 0, 490)).toBeNull();
    expect(thumbGeometry(500, 400, 0, 490)).toBeNull();
  });
  it('sizes the thumb by the visible fraction and places it by scroll position', () => {
    const top = thumbGeometry(500, 1000, 0, 490)!;
    expect(top.size).toBeCloseTo(245);
    expect(top.offset).toBe(0);
    const end = thumbGeometry(500, 1000, 500, 490)!;
    expect(end.offset).toBeCloseTo(490 - 245);
  });
  it('never shrinks the thumb below the minimum', () => {
    expect(thumbGeometry(100, 100000, 0, 90)!.size).toBe(28);
  });
  it('maps a thumb offset back to the scroll position (round trip)', () => {
    const g = thumbGeometry(500, 2000, 750, 490)!;
    expect(scrollForThumb(g.offset, g.size, 490, 500, 2000)).toBeCloseTo(750);
    expect(scrollForThumb(-50, g.size, 490, 500, 2000)).toBe(0);
    expect(scrollForThumb(9999, g.size, 490, 500, 2000)).toBeCloseTo(1500);
  });
});
