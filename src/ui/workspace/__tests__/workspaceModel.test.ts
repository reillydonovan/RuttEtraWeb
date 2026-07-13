/**
 * Workspace region model — swap semantics, normalization (the reset
 * path doubles as the validator), and layout presets.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ASSIGNMENT, normalizeViewId, normalizeAssignment, resolveAssignment,
  LAYOUT_PRESETS, getPreset,
} from '../workspaceModel';

describe('normalizeViewId', () => {
  it('accepts known ids and falls back on garbage', () => {
    expect(normalizeViewId('timeline', 'panel')).toBe('timeline');
    expect(normalizeViewId('patchbay', 'panel')).toBe('patchbay');
    expect(normalizeViewId('chrome-1998', 'panel')).toBe('panel');
    expect(normalizeViewId(undefined, 'timeline')).toBe('timeline');
    expect(normalizeViewId(42, 'panel')).toBe('panel');
  });
});

describe('normalizeAssignment', () => {
  it('passes a valid assignment through', () => {
    expect(normalizeAssignment({ side: 'timeline', dock: 'panel' }))
      .toEqual({ side: 'timeline', dock: 'panel' });
  });
  it('null/garbage resets to defaults', () => {
    expect(normalizeAssignment(null)).toEqual(DEFAULT_ASSIGNMENT);
    expect(normalizeAssignment({ side: 'x', dock: 'y' })).toEqual(DEFAULT_ASSIGNMENT);
  });
  it('same-view collision resets BOTH to defaults', () => {
    expect(normalizeAssignment({ side: 'timeline', dock: 'timeline' })).toEqual(DEFAULT_ASSIGNMENT);
  });
});

describe('resolveAssignment (Unity swap semantics)', () => {
  it('assigning an unhosted view just replaces the region', () => {
    expect(resolveAssignment({ side: 'panel', dock: 'timeline' }, 'dock', 'output'))
      .toEqual({ side: 'panel', dock: 'output' });
  });
  it('assigning the other region’s view swaps the two', () => {
    expect(resolveAssignment({ side: 'panel', dock: 'timeline' }, 'side', 'timeline'))
      .toEqual({ side: 'timeline', dock: 'panel' });
    expect(resolveAssignment({ side: 'timeline', dock: 'panel' }, 'dock', 'timeline'))
      .toEqual({ side: 'panel', dock: 'timeline' });
  });
  it('re-assigning the same view is a no-op', () => {
    expect(resolveAssignment({ side: 'panel', dock: 'timeline' }, 'side', 'panel'))
      .toEqual({ side: 'panel', dock: 'timeline' });
  });
});

describe('layout presets', () => {
  it('every preset carries a valid (non-colliding) assignment', () => {
    for (const p of LAYOUT_PRESETS) {
      expect(normalizeAssignment(p.assignment)).toEqual(p.assignment);
    }
  });
  it('default preset is the escape hatch: today’s stock layout', () => {
    const d = getPreset('default')!;
    expect(d.assignment).toEqual(DEFAULT_ASSIGNMENT);
    expect(d.panelCollapsed).toBe(false);
    expect(d.timelineDock).toBe('bottom');
  });
  it('unknown preset id resolves to undefined (caller no-ops)', () => {
    expect(getPreset('nope')).toBeUndefined();
  });
});
