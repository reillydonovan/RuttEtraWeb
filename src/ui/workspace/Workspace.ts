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
import { attachTooltip } from '../tooltip';
import type { SettingsStore } from '../../state/Settings';
import { layoutManager } from '../layout/LayoutManager';
import {
  Assignment, RegionId, ViewId, DropZone, DEFAULT_ASSIGNMENT,
  normalizeAssignment, resolveAssignment, resolveDrop, getPreset,
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
  /** Register a late-loading view (patch bay) — adds it to every
   *  region's dropdown and re-hosts if an assignment already wants it. */
  registerView(id: ViewId, el: HTMLElement): void;
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

/** Views selectable at construction; late registrations (patch bay)
 *  extend the dropdowns via registerView(). */
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
    const grip = document.createElement('span');
    grip.className = 'rw-region-grip';
    grip.textContent = '⠿';
    attachTooltip(grip, 'Drag to dock this window on any screen edge (Unity/Blender style).');
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

    // Maximize (Unity Shift+Space style) + collapse buttons, right side.
    const spacer = document.createElement('span');
    spacer.className = 'rw-region-bar-spacer';
    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'rw-region-btn';
    maxBtn.textContent = '⤢';
    attachTooltip(maxBtn, 'Maximize this window (near-fullscreen); click again to restore.');
    maxBtn.addEventListener('click', () => toggleMaximize(id));
    const colBtn = document.createElement('button');
    colBtn.type = 'button';
    colBtn.className = 'rw-region-btn';
    colBtn.textContent = '–';
    attachTooltip(colBtn, 'Collapse this window (the shell keeps a strip to restore it).');
    colBtn.addEventListener('click', () => toggleCollapse(id));

    bar.append(grip, label, select, spacer, maxBtn, colBtn);
    shell.insertBefore(bar, shell.firstChild);
    const region: Region = { id, shell, bar, select, hosted: null };
    regions.set(id, region);

    // Drag-to-dock gesture: pointerdown anywhere on the bar (except its
    // interactive children) starts a drag after a small threshold; drop
    // zones on the four screen edges re-dock the region's view.
    bar.addEventListener('pointerdown', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('select, button')) return;
      beginBarDrag(ev, region);
    });
    // Double-click the bar = maximize toggle (Unity muscle memory).
    bar.addEventListener('dblclick', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('select, button')) return;
      toggleMaximize(id);
    });
    return region;
  }

  buildRegionBar('side', deps.panelShell);

  // ------------------- maximize / collapse --------------------------
  // Maximize is TRANSIENT session state (like Unity's pane maximize) —
  // an overlay, not a layout change, so nothing persists and
  // availableCanvasRect() skips maximized shells (data-region-max).
  let maximized: RegionId | null = null;

  function toggleMaximize(id: RegionId): void {
    const next = maximized === id ? null : id;
    for (const r of regions.values()) {
      const on = r.id === next;
      r.shell.classList.toggle('rw-region-max', on);
      if (on) r.shell.setAttribute('data-region-max', '');
      else r.shell.removeAttribute('data-region-max');
    }
    maximized = next;
    window.dispatchEvent(new Event('rw:layout-resize'));
  }

  function toggleCollapse(id: RegionId): void {
    if (maximized === id) toggleMaximize(id);
    if (id === 'side') {
      settings.set('panelCollapsed', !settings.get('panelCollapsed'));
    } else {
      const cur = settings.get('timelineDock');
      settings.set('timelineDock', cur === 'hidden' ? settings.get('timelineLastDock') : 'hidden');
    }
  }

  // ------------------- drag-to-dock gesture -------------------------
  const DRAG_THRESHOLD = 6;

  function buildDropZones(): { overlay: HTMLElement; zones: Map<DropZone, HTMLElement> } {
    const overlay = document.createElement('div');
    overlay.className = 'rw-dropzones';
    const zones = new Map<DropZone, HTMLElement>();
    for (const z of ['left', 'right', 'top', 'bottom'] as DropZone[]) {
      const el = document.createElement('div');
      el.className = `rw-dropzone rw-dropzone--${z}`;
      el.dataset.zone = z;
      overlay.appendChild(el);
      zones.set(z, el);
    }
    return { overlay, zones };
  }

  /** Geometric zone hit-test: edge strips ~18% of each axis. */
  function zoneAt(x: number, y: number): DropZone | null {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (x < vw * 0.18) return 'left';
    if (x > vw * 0.82) return 'right';
    if (y < vh * 0.30) return 'top';
    if (y > vh * 0.70) return 'bottom';
    return null;
  }

  function beginBarDrag(ev: PointerEvent, region: Region): void {
    if (!region.hosted) return;
    const view = region.hosted;
    const startX = ev.clientX, startY = ev.clientY;
    const pid = ev.pointerId;
    let started = false;
    let ghost: HTMLElement | null = null;
    let dz: { overlay: HTMLElement; zones: Map<DropZone, HTMLElement> } | null = null;
    let hover: DropZone | null = null;

    const start = (): void => {
      started = true;
      if (maximized) toggleMaximize(maximized); // can't dock a maximized pane
      ghost = document.createElement('div');
      ghost.className = 'rw-drag-ghost';
      ghost.textContent = VIEW_LABELS[view];
      document.body.appendChild(ghost);
      dz = buildDropZones();
      document.body.appendChild(dz.overlay);
      document.body.classList.add('rw-region-dragging');
    };

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        start();
      }
      e.preventDefault();
      if (ghost) {
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY + 12}px`;
      }
      const z = zoneAt(e.clientX, e.clientY);
      if (z !== hover && dz) {
        if (hover) dz.zones.get(hover)?.classList.remove('active');
        hover = z;
        if (hover) dz.zones.get(hover)?.classList.add('active');
      }
    };
    const finish = (apply: boolean): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      ghost?.remove();
      dz?.overlay.remove();
      document.body.classList.remove('rw-region-dragging');
      if (apply && hover) {
        const next = resolveDrop({
          assignment: currentAssignment(),
          panelDock: settings.get('panelDock'),
          timelineDock: settings.get('timelineDock'),
        }, view, hover);
        settings.set('panelRegionView', next.assignment.side);
        settings.set('dockRegionView', next.assignment.dock);
        settings.set('panelDock', next.panelDock);
        settings.set('timelineDock', next.timelineDock);
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      finish(true);
    };
    const onCancel = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      finish(false);
    };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }

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
    registerView(id: ViewId, el: HTMLElement): void {
      viewEls.set(id, el);
      for (const r of regions.values()) {
        if (!r.select.querySelector(`option[value="${id}"]`)) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = VIEW_LABELS[id];
          r.select.appendChild(opt);
        }
      }
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
