/**
 * Workspace window/tab model (v1.12, Unity dock model). The owner's
 * bright line under test: moving/adding a view NEVER assigns anything
 * new to another window — the source window only falls back to its own
 * next tab.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TABS, normalizeViewId, normalizeTabsState, windowOf,
  moveView, activateTab, closeTab, LAYOUT_PRESETS, getPreset, TabsState,
} from '../workspaceModel';

const state = (tabs: Partial<TabsState['tabs']>, active?: Partial<TabsState['active']>): TabsState =>
  normalizeTabsState({
    tabs: { center: [], left: [], right: [], bottom: [], ...tabs } as TabsState['tabs'],
    active: { center: null, left: null, right: null, bottom: null, ...active } as TabsState['active'],
  });

describe('normalizeViewId', () => {
  it('accepts known ids, maps legacy output, falls back on garbage', () => {
    expect(normalizeViewId('patchbay', 'panel')).toBe('patchbay');
    expect(normalizeViewId('output', 'panel')).toBe('renderer');
    expect(normalizeViewId('holodeck', 'panel')).toBe('panel');
  });
});

describe('normalizeTabsState', () => {
  it('null → empty everywhere (views may be closed; DEFAULTS/migrations seed real state)', () => {
    const s = normalizeTabsState(null);
    expect(s.tabs.center).toEqual([]);
    expect(s.active.center).toBeNull();
  });

  it('a view appearing in two windows keeps only its first home', () => {
    const s = state({ center: ['renderer'], right: ['panel'], bottom: ['panel', 'timeline'] });
    expect(s.tabs.right).toEqual(['panel']);
    expect(s.tabs.bottom).toEqual(['timeline']);
  });

  it('unknown ids drop; actives must be members (else first tab)', () => {
    const s = normalizeTabsState({
      tabs: { center: ['renderer', 'holodeck' as never], left: [], right: ['panel'], bottom: [] },
      active: { center: 'panel' as never, left: null, right: 'panel', bottom: 'timeline' as never },
    });
    expect(s.tabs.center).toEqual(['renderer']);
    expect(s.active.center).toBe('renderer'); // fell back to first tab
    expect(s.active.bottom).toBeNull();
  });
});

describe('moveView (the no-side-effects rule)', () => {
  const base = DEFAULT_TABS; // center:[renderer] left:[patchbay] right:[panel] bottom:[timeline]

  it('moves a view to another window and activates it there', () => {
    const s = moveView(base, 'panel', 'bottom');
    expect(s.tabs.bottom).toEqual(['timeline', 'panel']);
    expect(s.active.bottom).toBe('panel');
    expect(s.tabs.right).toEqual([]);
  });

  it('NEVER assigns a new view to the source window — it just empties or falls back', () => {
    const s = moveView(base, 'panel', 'bottom');
    // right lost its only tab: nothing was pushed into it.
    expect(s.tabs.right).toEqual([]);
    expect(s.active.right).toBeNull();
    // and no other window changed at all.
    expect(s.tabs.center).toEqual(base.tabs.center);
    expect(s.tabs.left).toEqual(base.tabs.left);
    expect(s.active.center).toBe('renderer');
  });

  it('source with multiple tabs falls back to its own neighboring tab', () => {
    const multi = state(
      { center: ['renderer'], bottom: ['timeline', 'panel', 'patchbay'] },
      { bottom: 'panel' },
    );
    const s = moveView(multi, 'panel', 'center');
    expect(s.tabs.bottom).toEqual(['timeline', 'patchbay']);
    expect(s.active.bottom).toBe('patchbay'); // its own next tab, nothing new
    expect(s.active.center).toBe('panel');
    expect(s.tabs.center).toEqual(['renderer', 'panel']);
  });

  it('moving within the same window reorders without duplication', () => {
    const multi = state({ center: ['renderer'], bottom: ['timeline', 'panel'] });
    const s = moveView(multi, 'panel', 'bottom', 0);
    expect(s.tabs.bottom).toEqual(['panel', 'timeline']);
  });
});

describe('closeTab', () => {
  it('removes the view from the window; it lives nowhere (reopen via +)', () => {
    const s = closeTab(DEFAULT_TABS, 'left', 'patchbay');
    expect(s.tabs.left).toEqual([]);
    expect(s.active.left).toBeNull();
    expect(windowOf(s, 'patchbay')).toBeNull();
    // No other window touched.
    expect(s.tabs.center).toEqual(DEFAULT_TABS.tabs.center);
  });

  it('active falls back to the neighboring tab', () => {
    const multi = state({ center: ['renderer'], bottom: ['timeline', 'panel', 'patchbay'] }, { bottom: 'panel' });
    const s = closeTab(multi, 'bottom', 'panel');
    expect(s.tabs.bottom).toEqual(['timeline', 'patchbay']);
    expect(s.active.bottom).toBe('patchbay');
  });

  it('no-op when the window does not hold the view', () => {
    expect(closeTab(DEFAULT_TABS, 'center', 'panel')).toEqual(DEFAULT_TABS);
  });
});

describe('activateTab', () => {
  it('switches the active tab; no-op for non-members', () => {
    const multi = state({ center: ['renderer'], bottom: ['timeline', 'panel'] });
    expect(activateTab(multi, 'bottom', 'panel').active.bottom).toBe('panel');
    expect(activateTab(multi, 'bottom', 'patchbay').active.bottom).toBe('timeline');
  });
});

describe('layout presets (Unity family)', () => {
  it('exposes the expected preset ids', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id))
      .toEqual(['default', 'classic', 'tall', 'wide', 'performance', 'patchbay']);
  });

  it('default is the owner 4-up: bay left, renderer center, controls right, timeline bottom', () => {
    const d = getPreset('default')!;
    expect(d.state.tabs).toEqual({
      center: ['renderer'], left: ['patchbay'], right: ['panel'], bottom: ['timeline'],
    });
  });

  it('tall stacks everything into the right column as tabs', () => {
    const t = getPreset('tall')!;
    expect(t.state.tabs.right).toEqual(['panel', 'timeline', 'patchbay']);
    expect(t.state.tabs.bottom).toEqual([]);
  });

  it('every preset normalizes to itself (no duplicate homes, renderer present)', () => {
    for (const p of LAYOUT_PRESETS) {
      expect(normalizeTabsState(p.state)).toEqual(p.state);
    }
  });
});
