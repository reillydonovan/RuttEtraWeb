import { describe, it, expect } from 'vitest';
import { isPatternRouted } from '../VideoCompositor';

const route = (over: Record<string, string> = {}) => (k: string) =>
  ({ videoRendererIn: 'sourceA', videoCompositeInA: 'sourceA', videoCompositeInB: 'sourceB', videoDualRasterInA: 'none', videoDualRasterInB: 'none', ...over })[k]!;

describe('isPatternRouted', () => {
  it('is false for the default routing (overlay role)', () => {
    expect(isPatternRouted(route())).toBe(false);
  });
  it('is true when the Pattern OUT feeds any input', () => {
    expect(isPatternRouted(route({ videoRendererIn: 'pattern' }))).toBe(true);
    expect(isPatternRouted(route({ videoCompositeInB: 'pattern' }))).toBe(true);
    expect(isPatternRouted(route({ videoDualRasterInB: 'pattern' }))).toBe(true);
  });
});
