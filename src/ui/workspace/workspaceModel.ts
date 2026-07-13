/**
 * Pure model for the workspace region system — DOM-free, node-tested.
 *
 * Two dock regions decorate the two existing layout shells (no new
 * split-tree — the shells already own geometry, persistence, resize
 * handles, and live measurement by availableCanvasRect()):
 *
 *   'side' = #panel-root      (panelDock / panelWidth / panelCollapsed)
 *   'dock' = #timeline-dock   (timelineDock / timelineHeight)
 *
 * The CENTER region is the renderer, permanently — there is one
 * WebGLRenderer (documented v1 limitation); "Output" in a side/dock
 * region is a captureStream mirror, same trick as RenderPopout.
 *
 * Unity swap semantics: a view lives in at most one region. Assigning a
 * view already hosted by the other region swaps the two, so no region
 * is ever empty.
 */

export type ViewId = 'panel' | 'timeline' | 'output' | 'patchbay';
export type RegionId = 'side' | 'dock';

export interface Assignment {
  side: ViewId;
  dock: ViewId;
}

export const DEFAULT_ASSIGNMENT: Assignment = { side: 'panel', dock: 'timeline' };

const VALID_VIEWS: readonly ViewId[] = ['panel', 'timeline', 'output', 'patchbay'];

export function normalizeViewId(v: unknown, fallback: ViewId): ViewId {
  return typeof v === 'string' && (VALID_VIEWS as readonly string[]).includes(v)
    ? (v as ViewId)
    : fallback;
}

/**
 * Normalize a possibly-foreign assignment (old project files, hand
 * edits). Unknown ids fall back per-region; a same-view collision
 * resets BOTH to defaults — the reset path doubles as the validator, so
 * there is no silently-broken half state.
 */
export function normalizeAssignment(raw: { side?: unknown; dock?: unknown } | null | undefined): Assignment {
  const side = normalizeViewId(raw?.side, DEFAULT_ASSIGNMENT.side);
  const dock = normalizeViewId(raw?.dock, DEFAULT_ASSIGNMENT.dock);
  if (side === dock) return { ...DEFAULT_ASSIGNMENT };
  return { side, dock };
}

/**
 * Assign `view` to `region`. If the other region currently hosts that
 * view, the regions swap. Always returns a normalized assignment.
 */
export function resolveAssignment(prev: Assignment, region: RegionId, view: ViewId): Assignment {
  const other: RegionId = region === 'side' ? 'dock' : 'side';
  const next: Assignment = { ...prev };
  if (prev[other] === view) next[other] = prev[region];
  next[region] = view;
  return normalizeAssignment(next);
}

// ---------------------------------------------------------------------
// Layout presets (Window ▸ Layout) — Unity-style named layouts plus the
// "Reset Layout" escape hatch for a window state you don't like.
// Plain literals over the SAME Settings keys the shells already persist.
// ---------------------------------------------------------------------

export interface LayoutPreset {
  id: string;
  label: string;
  assignment: Assignment;
  panelCollapsed: boolean;
  panelWidth: number;
  timelineDock: 'top' | 'bottom' | 'hidden';
  timelineHeight: number;
}

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'default', label: 'Default',
    assignment: { ...DEFAULT_ASSIGNMENT },
    panelCollapsed: false, panelWidth: 360,
    timelineDock: 'bottom', timelineHeight: 220,
  },
  {
    id: 'performance', label: 'Performance (output maximized)',
    assignment: { ...DEFAULT_ASSIGNMENT },
    panelCollapsed: true, panelWidth: 360,
    timelineDock: 'hidden', timelineHeight: 220,
  },
  {
    id: 'editing', label: 'Editing (tall timeline)',
    assignment: { ...DEFAULT_ASSIGNMENT },
    panelCollapsed: false, panelWidth: 360,
    timelineDock: 'bottom', timelineHeight: 380,
  },
];

export function getPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
