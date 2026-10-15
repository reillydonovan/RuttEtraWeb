import { describe, it, expect } from 'vitest';
import { GLOW_SELECTOR, localPoint } from '../themeGlow';

describe('themeGlow', () => {
  it('maps the pointer into the element\'s own CSS pixels', () => {
    expect(localPoint(150, 80, { left: 100, top: 50, width: 200 }, 200)).toEqual({ x: 50, y: 30 });
  });
  it('divides out CSS zoom (visual px / layout px)', () => {
    // 1.1x zoom: rect is 220 visual px wide for a 200px layout box
    const p = localPoint(210, 105, { left: 100, top: 50, width: 220 }, 200);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });
  it('falls back to 1:1 for degenerate ratios', () => {
    expect(localPoint(10, 10, { left: 0, top: 0, width: 100 }, 0)).toEqual({ x: 10, y: 10 });
  });
  it('lists the Patch Bay and Controls surfaces', () => {
    expect(GLOW_SELECTOR).toContain('.rw-pb-module');
    expect(GLOW_SELECTOR).toContain('.rw-section');
  });
});
