/**
 * Workspace region manager — Unity-style "any pane can host any view".
 *
 * Decorates the two EXISTING layout shells (#panel-root = 'side',
 * #timeline-dock = 'dock') with a slim region bar whose dropdown picks
 * the hosted view; the shells keep their own geometry, persistence,
 * resize handles, and the live-rect measurement availableCanvasRect()
 * already does. The CENTER region is the renderer, permanently (one
 * WebGLRenderer — v1 limitation); 'output' in a side/dock region is a
 * captureStream mirror, the RenderPopout trick in-page.
 *
 * Views are the movable CONTENT wrappers the shells expose
 * (ControlPanel.viewRoot, TimelineDock.viewRoot); re-parenting them is
 * the exact pattern ResponsivePanel proved for compact bottom-sheets.
 * Assignment state lives in Settings (panelRegionView/dockRegionView,
 * v29) so a project reopens into the workspace it was built in.
 *
 * Coexistence: compact/touch keeps today's behavior — the region bars
 * are CSS-hidden there and this manager force-hosts defaults while
 * compact is active WITHOUT writing Settings (transient), restoring
 * the persisted arrangement on exit. Same transient rule while the
 * panel popout owns the panel shell (popout wins).
 */

import './workspace.css';
import type { SettingsStore } from '../../state/Settings';
import { layoutManager } from '../layout/LayoutManager';
import {
  Assignment, RegionId, ViewId, DEFAULT_ASSIGNMENT,
  normalizeAssignment, resolveAssignment, getPreset,
} from './workspaceModel';

interface WorkspaceDeps {
  settings: SettingsStore;
  /** The renderer's live canvas — source for the 'output' mirror view. */
  canvas: HTMLCanvasElement;
  panelShell: HTMLElement;
  panelViewEl: HTMLElement;
}

export interface WorkspaceController {
  /** Wire the dock shell once the TimelineDock exists (it is created
   *  lazily, and its build() wipes the shell's children). */
  attachDockRegion(dockShell: HTMLElement, timelineViewEl: HTMLElement): void;
  /** Popout arbitration: while the panel popout is open, force default
   *  hosting transiently (no Settings writes). */
  onPanelPopout(open: boolean): void;
  applyPreset(id: string): void;
  /** Region label → for the Window menu radios. */
  getAssignment(): Assignment;
  setRegionView(region: RegionId, view: ViewId): void;
}

const VIEW_LABELS: Record<ViewId, string> = {
  panel: 'CONTROLS',
  timeline: 'TIMELINE',
  output: 'OUTPUT (MIRROR)',
  patchbay: 'PATCH BAY',
};

/** Views selectable in the dropdowns. 'patchbay' joins in Phase 3. */
const SELECTABLE: readonly ViewId[] = ['panel', 'timeline', 'output'];

export function createWorkspace(deps: WorkspaceDeps): WorkspaceController {
  const { settings, canvas } = deps;
  const layout = layoutManager();

  /** Hidden parking lot for views not currently hosted anywhere. */
  const park = document.createElement('div');
  park.id = 'rw-view-park';
  document.body.appendChild(park);

  // ------------------------- output mirror -------------------------
  let outputEl: HTMLElement | null = null;
  let outputVideo: HTMLVideoElement | null = null;
  let outputStream: MediaStream | null = null;
  function getOutputView(): HTMLElement {
    if (!outputEl) {
      outputEl = document.createElement('div');
      outputEl.className = 'rw-view-output';
      outputVideo = document.createElement('video');
      outputVideo.muted = true;
      outputVideo.autoplay = true;
      outputVideo.playsInline = true;
      outputEl.appendChild(outputVideo);
    }
    return outputEl;
  }
  function startMirror(): void {
    if (!outputVideo) return;
    stopMirror();
    outputStream = canvas.captureStream(30);
    outputVideo.srcObject = outputStream;
  }
  function stopMirror(): void {
    outputStream?.getTracks().forEach((t) => t.stop());
    outputStream = null;
    if (outputVideo) outputVideo.srcObject = null;
  }

  // ------------------------- regions -------------------------------
  interface Region {
    id: RegionId;
    shell: HTMLElement;
    bar: HTMLElement;
    select: HTMLSelectElement;
    /** Currently hosted view element (content mounts after the bar). */
    hosted: ViewId | null;
  }

  const viewEls = new Map<ViewId, HTMLElement>();
  viewEls.set('panel', deps.panelViewEl);

  const regions = new Map<RegionId, Region>();

  function buildRegionBar(id: RegionId, shell: HTMLElement): Region {
    const bar = document.createElement('div');
    bar.className = 'rw-region-bar';
    const label = document.createElement('span');
    label.className = 'rw-region-bar-label';
    label.textContent = id === 'side' ? 'SIDE' : 'DOCK';
    const select = document.createElement('select');
    select.className = 'rw-region-select';
    for (const v of SELECTABLE) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = VIEW_LABELS[v];
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setRegionView(id, select.value as ViewId);
    });
    bar.append(label, select);
    shell.insertBefore(bar, shell.firstChild);
    const region: Region = { id, shell, bar, select, hosted: null };
    regions.set(id, region);
    return region;
  }

  buildRegionBar('side', deps.panelShell);

  // ------------------------- hosting -------------------------------
  let transientDefaults = false; // compact layout or panel popout open

  function currentAssignment(): Assignment {
    return normalizeAssignment({
      side: settings.get('panelRegionView'),
      dock: settings.get('dockRegionView'),
    });
  }

  function mount(region: Region, view: ViewId): void {
    if (region.hosted === view) return;
    // Park whatever is currently after the bar that belongs to us.
    if (region.hosted) {
      const prev = viewEls.get(region.hosted);
      if (prev) park.appendChild(prev);
      if (region.hosted === 'output') stopMirror();
    }
    const el = viewEls.get(view);
    if (el) {
      region.shell.appendChild(el);
      if (view === 'output') startMirror();
    }
    region.hosted = view;
    region.select.value = view;
    region.shell.dataset.regionView = view;
  }

  function applyAssignment(a: Assignment): void {
    const side = regions.get('side');
    const dock = regions.get('dock');
    // Two-phase: park both non-matching views first so a swap never has
    // one element in two prospective homes.
    for (const r of [side, dock]) {
      if (!r) continue;
      const want = a[r.id];
      if (r.hosted && r.hosted !== want) {
        const prev = viewEls.get(r.hosted);
        if (prev) park.appendChild(prev);
        if (r.hosted === 'output') stopMirror();
        r.hosted = null;
      }
    }
    for (const r of [side, dock]) {
      if (r) mount(r, a[r.id]);
    }
    window.dispatchEvent(new Event('rw:layout-resize'));
  }

  function refresh(): void {
    if (!regions.has('dock')) {
      // Dock shell not wired yet — host the side region only.
      const side = regions.get('side')!;
      mount(side, transientDefaults ? DEFAULT_ASSIGNMENT.side : currentAssignment().side);
      return;
    }
    applyAssignment(transientDefaults ? DEFAULT_ASSIGNMENT : currentAssignment());
  }

  function setRegionView(region: RegionId, view: ViewId): void {
    if (view === 'output' && !SELECTABLE.includes(view)) return;
    const next = resolveAssignment(currentAssignment(), region, view);
    // Both keys written; subscriptions below re-host idempotently.
    settings.set('panelRegionView', next.side);
    settings.set('dockRegionView', next.dock);
  }

  let popoutOpen = false;

  settings.subscribe('panelRegionView', refresh);
  settings.subscribe('dockRegionView', refresh);

  // Compact: force defaults transiently — ResponsivePanel owns compact
  // and expects the panel content in the panel shell. (onModeChange
  // fires immediately, so popoutOpen must already be declared.)
  layout.onModeChange((mode) => {
    transientDefaults = mode === 'compact' || popoutOpen;
    refresh();
  });

  refresh();

  return {
    attachDockRegion(dockShell: HTMLElement, timelineViewEl: HTMLElement): void {
      viewEls.set('timeline', timelineViewEl);
      viewEls.set('output', getOutputView());
      if (!regions.has('dock')) buildRegionBar('dock', dockShell);
      refresh();
    },
    onPanelPopout(open: boolean): void {
      popoutOpen = open;
      transientDefaults = open || layout.current() === 'compact';
      refresh();
    },
    applyPreset(id: string): void {
      const p = getPreset(id);
      if (!p) return;
      settings.set('panelRegionView', p.assignment.side);
      settings.set('dockRegionView', p.assignment.dock);
      settings.set('panelCollapsed', p.panelCollapsed);
      settings.set('panelWidth', p.panelWidth);
      settings.set('timelineDock', p.timelineDock);
      settings.set('timelineHeight', p.timelineHeight);
    },
    getAssignment: currentAssignment,
    setRegionView,
  };
}
