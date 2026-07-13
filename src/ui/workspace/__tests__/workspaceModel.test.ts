/**
 * Workspace region model — swap semantics, normalization (the reset
 * path doubles as the validator), and layout presets.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ASSIGNMENT, normalizeViewId, normalizeAssignment, resolveAssignment,
  resolveDrop, LAYOUT_PRESETS, getPreset,
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

describe('resolveDrop (drag a window to a screen edge)', () => {
  const base = {
    assignment: { side: 'panel', dock: 'timeline' } as const,
    panelDock: 'right' as const,
    timelineDock: 'bottom' as const,
  };

  it('panel → left edge: side shell docks left, hosting unchanged', () => {
    expect(resolveDrop(base, 'panel', 'left')).toEqual({
      assignment: { side: 'panel', dock: 'timeline' },
      panelDock: 'left',
      timelineDock: 'bottom',
    });
  });

  it('timeline → top edge: dock shell docks top', () => {
    expect(resolveDrop(base, 'timeline', 'top')).toEqual({
      assignment: { side: 'panel', dock: 'timeline' },
      panelDock: 'right',
      timelineDock: 'top',
    });
  });

  it('timeline → right edge: timeline moves into the side shell (swap), shell docks right', () => {
    expect(resolveDrop(base, 'timeline', 'right')).toEqual({
      assignment: { side: 'timeline', dock: 'panel' },
      panelDock: 'right',
      timelineDock: 'bottom',
    });
  });

  it('panel → bottom edge: panel moves into the dock shell (swap)', () => {
    expect(resolveDrop(base, 'panel', 'bottom')).toEqual({
      assignment: { side: 'timeline', dock: 'panel' },
      panelDock: 'right',
      timelineDock: 'bottom',
    });
  });

  it('dropping on top/bottom un-hides a hidden dock', () => {
    const hidden = { ...base, timelineDock: 'hidden' as const };
    expect(resolveDrop(hidden, 'timeline', 'bottom').timelineDock).toBe('bottom');
  });

  it('patch bay → left edge: bay takes the side shell, panel displaced to dock? No — swap only when held', () => {
    // patchbay is unhosted in `base`, so the side view is simply replaced
    // (panel parks) — matching setRegionView semantics.
    expect(resolveDrop(base, 'patchbay', 'left')).toEqual({
      assignment: { side: 'patchbay', dock: 'timeline' },
      panelDock: 'left',
      timelineDock: 'bottom',
    });
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
