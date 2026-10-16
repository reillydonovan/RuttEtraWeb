/**
 * Pure model for the workspace window/tab system — DOM-free, node-tested.
 * Design system: docs/design/workspace-regions.md (keep in sync).
 *
 * v1.12 (Unity tab model, owner-directed): FOUR windows, each holding an
 * ordered list of TABS with one active tab — exactly Unity's dock model:
 *
 *   'center' = #rw-center-shell   (positioned to availableCanvasRect())
 *   'left'   = #rw-left-shell     (leftPanelWidth; hidden when empty)
 *   'right'  = #panel-root        (panelWidth/panelCollapsed; panelDock
 *                                  is forced 'right' since v31)
 *   'bottom' = #timeline-dock     (timelineDock top/bottom/hidden,
 *                                  timelineHeight)
 *
 * A view lives in EXACTLY ONE window's tab list. Moving a view (drag its
 * tab, or add it via a window's "+" menu) removes it from its old window
 * — which simply activates its own next tab — and NEVER assigns anything
 * new to any other window. That is the owner's bright line between
 * intuitive and confusing: adjusting one window never changes another's
 * view beyond the removal fallback.
 *
 * The RENDERER view: pass-through when it is the ACTIVE tab of the
 * center window (the one real WebGL canvas renders beneath); a
 * captureStream mirror when active anywhere else; parked when inactive.
 */

export type ViewId = 'renderer' | 'panel' | 'timeline' | 'patchbay';
export type WindowId = 'center' | 'left' | 'right' | 'bottom';

export const WINDOW_IDS: readonly WindowId[] = ['center', 'left', 'right', 'bottom'];
const VALID_VIEWS: readonly ViewId[] = ['renderer', 'panel', 'timeline', 'patchbay'];

// EVERY view is fully multi-instance (owner rule, v1.12.1): any view
// may be tabbed — and VISIBLE — in any number of windows at once. Each
// window gets its own element instance from a per-view factory
// (Workspace.elementFor); all instances bind the same Settings/
// Sequencer stores, so they stay in sync by construction.

export interface TabsState {
  tabs: Record<WindowId, ViewId[]>;
  active: Record<WindowId, ViewId | null>;
}

/** The owner's 4-up default. Model ids: 'left' = the Patch Bay window,
 *  'right' = the Controls window — but the default `panelDock: 'left'`
 *  MIRRORS them on screen, so you see controls left, renderer center, bay
 *  right, timeline bottom (2026-10-15: the controls read first). */
export const DEFAULT_TABS: TabsState = {
  tabs: {
    center: ['renderer'],
    left: ['patchbay'],
    right: ['panel'],
    bottom: ['timeline'],
  },
  active: { center: 'renderer', left: 'patchbay', right: 'panel', bottom: 'timeline' },
};

export function normalizeViewId(v: unknown, fallback: ViewId): ViewId {
  if (v === 'output') return 'renderer'; // v29 legacy mirror view
  return typeof v === 'string' && (VALID_VIEWS as readonly string[]).includes(v)
    ? (v as ViewId)
    : fallback;
}

function cloneState(s: TabsState): TabsState {
  return {
    tabs: {
      center: [...s.tabs.center], left: [...s.tabs.left],
      right: [...s.tabs.right], bottom: [...s.tabs.bottom],
    },
    active: { ...s.active },
  };
}

/**
 * Validator/normalizer for possibly-foreign state (old files, hand
 * edits): unknown view ids drop out, a window never lists the same
 * view twice, and each window's active tab must be one of its tabs
 * (else its first tab, else null). A view may be tabbed in several
 * windows, or in none (a CLOSED tab — reopen via any window's "+");
 * there is no whole-state reset — tabs degrade gracefully.
 */
export function normalizeTabsState(raw: Partial<TabsState> | null | undefined): TabsState {
  const seenGlobal = new Set<ViewId>();
  const tabs = {} as TabsState['tabs'];
  for (const w of WINDOW_IDS) {
    const list: unknown[] = Array.isArray(raw?.tabs?.[w]) ? (raw!.tabs![w] as unknown[]) : [];
    tabs[w] = [];
    const seenHere = new Set<ViewId>();
    for (const v of list) {
      // Unknown ids drop out entirely (no fallback — a fallback here
      // would duplicate views); 'output' is the one legacy alias.
      if (v !== 'output' && !(VALID_VIEWS as readonly string[]).includes(v as string)) continue;
      const id = normalizeViewId(v, 'renderer');
      if (seenHere.has(id)) continue; // never twice in one window
      seenHere.add(id);
      seenGlobal.add(id);
      tabs[w].push(id);
    }
  }
  const active = {} as TabsState['active'];
  for (const w of WINDOW_IDS) {
    const want = raw?.active?.[w];
    active[w] = typeof want === 'string' && tabs[w].includes(normalizeViewId(want, 'renderer'))
      ? normalizeViewId(want, 'renderer')
      : (tabs[w][0] ?? null);
  }
  return { tabs, active };
}

/** FIRST window currently holding `view`, or null. */
export function windowOf(state: TabsState, view: ViewId): WindowId | null {
  for (const w of WINDOW_IDS) {
    if (state.tabs[w].includes(view)) return w;
  }
  return null;
}

/** Every window currently holding `view` (multi-instance views may
 *  have several). */
export function windowsOf(state: TabsState, view: ViewId): WindowId[] {
  return WINDOW_IDS.filter((w) => state.tabs[w].includes(view));
}

/**
 * Add `view` as a tab of `win` WITHOUT touching any other window — the
 * "+"-menu path for multi-instance views (a duplicate tab; each window
 * shows its own instance). If the window already holds it, it is just
 * activated. Single-instance views should go through moveView instead
 * (normalizeTabsState would strip an illegal duplicate anyway).
 */
export function addTab(state: TabsState, view: ViewId, win: WindowId): TabsState {
  const next = cloneState(state);
  if (!next.tabs[win].includes(view)) next.tabs[win].push(view);
  next.active[win] = view;
  return normalizeTabsState(next);
}

/**
 * Move ONE tab of `view` (from `from`, defaulting to its first home)
 * into window `to` (optionally at `index`) and activate it there. The
 * source window falls back to its own next remaining tab — no other
 * window is touched. Moving within the same window reorders. If the
 * target already holds this view (a multi-instance duplicate), the two
 * tabs merge: the dragged one leaves its source and the target's
 * existing tab activates/reorders — a window never shows the same view
 * twice.
 */
export function moveView(state: TabsState, view: ViewId, to: WindowId, index?: number, from?: WindowId): TabsState {
  const next = cloneState(state);
  const src = from ?? windowOf(next, view);
  if (src && next.tabs[src].includes(view)) {
    const i = next.tabs[src].indexOf(view);
    next.tabs[src].splice(i, 1);
    if (next.active[src] === view) {
      next.active[src] = next.tabs[src][Math.min(i, next.tabs[src].length - 1)] ?? null;
    }
  }
  const existing = next.tabs[to].indexOf(view);
  if (existing >= 0) next.tabs[to].splice(existing, 1);
  const at = index === undefined
    ? next.tabs[to].length
    : Math.max(0, Math.min(index, next.tabs[to].length));
  next.tabs[to].splice(at, 0, view);
  next.active[to] = view;
  return normalizeTabsState(next);
}

/**
 * Close THIS window's tab of the view (other windows' duplicate tabs
 * are untouched; a fully-closed view reopens via any window's "+").
 * The window's active falls back to its own neighboring tab — the same
 * no-side-effects rule as moveView.
 */
export function closeTab(state: TabsState, win: WindowId, view: ViewId): TabsState {
  if (!state.tabs[win].includes(view)) return state;
  const next = cloneState(state);
  const i = next.tabs[win].indexOf(view);
  next.tabs[win].splice(i, 1);
  if (next.active[win] === view) {
    next.active[win] = next.tabs[win][Math.min(i, next.tabs[win].length - 1)] ?? null;
  }
  return normalizeTabsState(next);
}

/** Activate an existing tab; no-op if the window doesn't hold it. */
export function activateTab(state: TabsState, win: WindowId, view: ViewId): TabsState {
  if (!state.tabs[win].includes(view)) return state;
  const next = cloneState(state);
  next.active[win] = view;
  return next;
}

// ---------------------------------------------------------------------
// Layout presets (Window ▸ Layout) — Unity's Default / Tall / Wide /
// 4 Split family, adapted. Plus Reset Layout = 'default'.
// ---------------------------------------------------------------------

export interface LayoutPreset {
  id: string;
  label: string;
  state: TabsState;
  /** Which edge the Controls shell docks to; the other side window mirrors to the opposite edge. */
  panelDock: 'left' | 'right';
  panelCollapsed: boolean;
  panelWidth: number;
  leftPanelWidth: number;
  timelineDock: 'top' | 'bottom' | 'hidden';
  timelineHeight: number;
}

const T = (tabs: TabsState['tabs']): TabsState => normalizeTabsState({ tabs, active: {} as TabsState['active'] });

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'default', label: 'Default (4-up)',
    state: T({ center: ['renderer'], left: ['patchbay'], right: ['panel'], bottom: ['timeline'] }),
    panelDock: 'left',
    panelCollapsed: false, panelWidth: 360, leftPanelWidth: 400,
    timelineDock: 'bottom', timelineHeight: 220,
  },
  {
    id: 'classic', label: 'Classic (no left window)',
    state: T({ center: ['renderer'], left: [], right: ['panel', 'patchbay'], bottom: ['timeline'] }),
    panelDock: 'right',
    panelCollapsed: false, panelWidth: 360, leftPanelWidth: 400,
    timelineDock: 'bottom', timelineHeight: 220,
  },
  {
    id: 'tall', label: 'Tall (everything in one column)',
    state: T({ center: ['renderer'], left: [], right: ['panel', 'timeline', 'patchbay'], bottom: [] }),
    panelDock: 'right',
    panelCollapsed: false, panelWidth: 480, leftPanelWidth: 400,
    timelineDock: 'hidden', timelineHeight: 220,
  },
  {
    id: 'wide', label: 'Wide (tall bottom strip)',
    state: T({ center: ['renderer'], left: [], right: [], bottom: ['timeline', 'panel', 'patchbay'] }),
    panelDock: 'right',
    panelCollapsed: false, panelWidth: 360, leftPanelWidth: 400,
    timelineDock: 'bottom', timelineHeight: 380,
  },
  {
    id: 'performance', label: 'Performance (output maximized)',
    state: T({ center: ['renderer'], left: [], right: ['panel', 'patchbay'], bottom: ['timeline'] }),
    panelDock: 'right',
    panelCollapsed: true, panelWidth: 360, leftPanelWidth: 400,
    timelineDock: 'hidden', timelineHeight: 220,
  },
  {
    id: 'patchbay', label: 'Patch Bay (bay center, output docked)',
    state: T({ center: ['patchbay', 'renderer'], left: [], right: ['panel'], bottom: ['timeline'] }),
    panelDock: 'right',
    panelCollapsed: false, panelWidth: 360, leftPanelWidth: 400,
    timelineDock: 'bottom', timelineHeight: 260,
  },
];

export function getPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
