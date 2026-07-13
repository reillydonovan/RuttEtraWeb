/**
 * Workspace window/tab manager — the Unity dock model.
 * Design system: docs/design/workspace-regions.md (keep in sync).
 *
 * FOUR windows, each with a TAB STRIP (click a tab to switch, drag a
 * tab to another window's strip or to a screen drop zone to move it,
 * "+" to pull any view into this window). Moving a view never assigns
 * anything to another window — the source window just falls back to
 * its own next tab, and a window with no tabs hides. State is the pure
 * TabsState in workspaceModel (Settings v31: workspaceTabs /
 * workspaceActive).
 *
 *   'center' = #rw-center-shell (positioned to availableCanvasRect())
 *   'left'   = #rw-left-shell   (leftPanelWidth; hidden when empty)
 *   'right'  = #panel-root      (panelWidth/panelCollapsed)
 *   'bottom' = #timeline-dock   (timelineDock/timelineHeight)
 *
 * The RENDERER view is pass-through while it is the center's ACTIVE
 * tab (the one real WebGL canvas renders beneath — never re-parent a
 * live GL canvas); a captureStream mirror while active elsewhere;
 * parked while inactive.
 *
 * Coexistence: compact/touch and the panel popout force the CLASSIC
 * hosting transiently (no Settings writes) — ResponsivePanel owns
 * compact and expects the panel content in #panel-root.
 */

import './workspace.css';
import { attachTooltip } from '../tooltip';
import type { SettingsStore } from '../../state/Settings';
import { layoutManager } from '../layout/LayoutManager';
import {
  TabsState, ViewId, WindowId,
  normalizeTabsState, moveView, addTab, activateTab, closeTab, windowOf, getPreset, MULTI_INSTANCE, WINDOW_IDS,
} from './workspaceModel';

interface WorkspaceDeps {
  settings: SettingsStore;
  canvas: HTMLCanvasElement;
  centerShell: HTMLElement;
  leftShell: HTMLElement;
  panelShell: HTMLElement;
  panelViewEl: HTMLElement;
}

export interface WorkspaceController {
  attachDockRegion(dockShell: HTMLElement, timelineViewEl: HTMLElement): void;
  /** Singleton views register an element; multi-instance views register
   *  a FACTORY (each window that tabs the view gets its own instance). */
  registerView(id: ViewId, el: HTMLElement | (() => HTMLElement)): void;
  onPanelPopout(open: boolean): void;
  applyPreset(id: string): void;
  getState(): TabsState;
  moveViewTo(view: ViewId, win: WindowId): void;
}

const VIEW_LABELS: Record<ViewId, string> = {
  renderer: 'RENDERER',
  panel: 'CONTROLS',
  timeline: 'TIMELINE',
  patchbay: 'PATCH BAY',
};

/** Transient hosting used in compact / while the panel popout is open. */
const CLASSIC_TABS: TabsState = normalizeTabsState({
  tabs: { center: ['renderer'], left: [], right: ['panel'], bottom: ['timeline'] },
  active: { center: 'renderer', left: null, right: 'panel', bottom: 'timeline' },
});

export function createWorkspace(deps: WorkspaceDeps): WorkspaceController {
  const { settings, canvas } = deps;
  const layout = layoutManager();

  /** Hidden parking lot for views not currently visible anywhere. */
  const park = document.createElement('div');
  park.id = 'rw-view-park';
  document.body.appendChild(park);

  // -------------------- view instances -------------------------------
  // Singleton views (Controls, Timeline) have ONE element. Multi-
  // instance views (Renderer, Patch Bay) have a factory; each window
  // that tabs them gets its own cached instance.
  const singletonEls = new Map<ViewId, HTMLElement>();
  const factories = new Map<ViewId, () => HTMLElement>();
  const instances = new Map<string, HTMLElement>(); // `view:win`

  singletonEls.set('panel', deps.panelViewEl);

  interface RendererInstance { el: HTMLElement; video: HTMLVideoElement; stream: MediaStream | null }
  const rendererInstances = new Map<string, RendererInstance>();

  function makeRendererInstance(key: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'rw-view-renderer';
    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    el.appendChild(video);
    rendererInstances.set(key, { el, video, stream: null });
    return el;
  }

  function setRendererInstanceMode(key: string, mode: 'passthrough' | 'mirror' | 'off'): void {
    const inst = rendererInstances.get(key);
    if (!inst) return;
    inst.el.classList.toggle('rw-view-renderer--passthrough', mode === 'passthrough');
    if (mode === 'mirror') {
      if (!inst.stream) {
        inst.stream = canvas.captureStream(30);
        inst.video.srcObject = inst.stream;
      }
    } else {
      inst.stream?.getTracks().forEach((t) => t.stop());
      inst.stream = null;
      inst.video.srcObject = null;
    }
  }

  function isAvailable(view: ViewId): boolean {
    return singletonEls.has(view) || factories.has(view) || view === 'renderer';
  }

  function elementFor(view: ViewId, win: WindowId): HTMLElement | null {
    if (singletonEls.has(view)) return singletonEls.get(view)!;
    const key = `${view}:${win}`;
    const cached = instances.get(key);
    if (cached) return cached;
    let el: HTMLElement | null = null;
    if (view === 'renderer') el = makeRendererInstance(key);
    else if (factories.has(view)) el = factories.get(view)!();
    if (el) instances.set(key, el);
    return el;
  }

  // ------------------------- state ----------------------------------
  let transientDefaults = false;
  let popoutOpen = false;

  function currentState(): TabsState {
    return normalizeTabsState({
      tabs: settings.get('workspaceTabs') as TabsState['tabs'],
      active: settings.get('workspaceActive') as TabsState['active'],
    });
  }

  function writeState(next: TabsState): void {
    settings.set('workspaceTabs', next.tabs as never);
    settings.set('workspaceActive', next.active as never);
  }

  // ------------------------- windows --------------------------------
  interface Win {
    id: WindowId;
    shell: HTMLElement;
    bar: HTMLElement;
    strip: HTMLElement;
    mounted: ViewId | null;
  }
  const windows = new Map<WindowId, Win>();

  function buildWindow(id: WindowId, shell: HTMLElement): Win {
    const bar = document.createElement('div');
    bar.className = 'rw-region-bar';
    bar.dataset.window = id;

    const strip = document.createElement('div');
    strip.className = 'rw-tabstrip';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'rw-region-btn rw-tab-add';
    addBtn.textContent = '+';
    attachTooltip(addBtn, 'Add a view to this window (moves it here from wherever it lives now).');
    addBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openAddMenu(addBtn, id);
    });

    const spacer = document.createElement('span');
    spacer.className = 'rw-region-bar-spacer';
    bar.append(strip, addBtn, spacer);

    if (id === 'right' || id === 'bottom') {
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
      attachTooltip(colBtn, 'Collapse this window (a strip remains to restore it).');
      colBtn.addEventListener('click', () => toggleCollapse(id));
      bar.append(maxBtn, colBtn);
    } else if (id === 'left') {
      const maxBtn = document.createElement('button');
      maxBtn.type = 'button';
      maxBtn.className = 'rw-region-btn';
      maxBtn.textContent = '⤢';
      attachTooltip(maxBtn, 'Maximize this window (near-fullscreen); click again to restore.');
      maxBtn.addEventListener('click', () => toggleMaximize(id));
      bar.append(maxBtn);
    }

    shell.insertBefore(bar, shell.firstChild);
    const win: Win = { id, shell, bar, strip, mounted: null };
    windows.set(id, win);
    bar.addEventListener('dblclick', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('select, button, .rw-wtab')) return;
      if (id !== 'center') toggleMaximize(id);
    });
    return win;
  }

  // Left window width handle (same drag pattern as the panel/dock).
  function buildLeftHandle(shell: HTMLElement): void {
    const handle = document.createElement('div');
    handle.className = 'rw-left-resize';
    attachTooltip(handle, 'Drag to resize this window.');
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      handle.setPointerCapture?.(ev.pointerId);
      const startX = ev.clientX;
      const startW = Math.max(220, Math.min(1400, settings.get('leftPanelWidth')));
      let lastW = startW;
      const onMove = (e: PointerEvent): void => {
        lastW = Math.max(220, Math.min(1400, startW + (e.clientX - startX)));
        shell.style.width = `${lastW}px`;
        publishLeftInset();
        window.dispatchEvent(new Event('rw:layout-resize'));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        settings.set('leftPanelWidth', Math.round(lastW));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    shell.appendChild(handle);
  }

  function publishLeftInset(): void {
    const w = deps.leftShell.classList.contains('rw-window-empty')
      ? 0
      : deps.leftShell.getBoundingClientRect().width;
    document.documentElement.style.setProperty('--rw-panel-inset-left', `${w}px`);
  }

  buildWindow('center', deps.centerShell);
  buildWindow('left', deps.leftShell);
  buildWindow('right', deps.panelShell);
  buildLeftHandle(deps.leftShell);
  settings.subscribe('leftPanelWidth', (w) => {
    deps.leftShell.style.width = `${Math.max(220, Math.min(1400, w as number))}px`;
    publishLeftInset();
    window.dispatchEvent(new Event('rw:layout-resize'));
  });

  // ------------------- maximize / collapse --------------------------
  let maximized: WindowId | null = null;

  function toggleMaximize(id: WindowId): void {
    const next = maximized === id ? null : id;
    for (const w of windows.values()) {
      const on = w.id === next;
      w.shell.classList.toggle('rw-region-max', on);
      if (on) w.shell.setAttribute('data-region-max', '');
      else w.shell.removeAttribute('data-region-max');
    }
    maximized = next;
    window.dispatchEvent(new Event('rw:layout-resize'));
  }

  function toggleCollapse(id: WindowId): void {
    if (maximized === id) toggleMaximize(id);
    if (id === 'right') {
      settings.set('panelCollapsed', !settings.get('panelCollapsed'));
    } else if (id === 'bottom') {
      const cur = settings.get('timelineDock');
      settings.set('timelineDock', cur === 'hidden' ? settings.get('timelineLastDock') : 'hidden');
    }
  }

  // ------------------- "+" add-view menu -----------------------------
  function openAddMenu(anchor: HTMLElement, win: WindowId): void {
    document.getElementById('rw-addview-menu')?.remove();
    const ul = document.createElement('ul');
    ul.id = 'rw-addview-menu';
    ul.className = 'rw-kf-menu';
    const r = anchor.getBoundingClientRect();
    ul.style.left = `${r.left}px`;
    ul.style.top = `${r.bottom + 4}px`;
    const state = currentState();
    for (const v of ['renderer', 'panel', 'timeline', 'patchbay'] as ViewId[]) {
      if (!isAvailable(v)) continue;
      const li = document.createElement('li');
      const here = state.tabs[win].includes(v);
      const home = windowOf(state, v);
      const multi = MULTI_INSTANCE.has(v);
      // Multi-instance views add a DUPLICATE tab — no other window is
      // affected. Single-instance views (one live DOM) must move, and
      // the label says so instead of doing it silently.
      li.textContent = here
        ? `${VIEW_LABELS[v]} (already here)`
        : multi || !home
          ? VIEW_LABELS[v]
          : `${VIEW_LABELS[v]} (moves here)`;
      if (here) li.classList.add('disabled');
      else li.addEventListener('click', () => {
        ul.remove();
        const cur = currentState();
        writeState(multi ? addTab(cur, v, win) : moveView(cur, v, win));
      });
      ul.appendChild(li);
    }
    document.body.appendChild(ul);
    const close = (e: Event): void => {
      if (e.target instanceof Node && ul.contains(e.target)) return;
      ul.remove();
      document.removeEventListener('pointerdown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
  }

  // ------------------- tab strip rendering ---------------------------
  function renderStrips(state: TabsState): void {
    for (const w of windows.values()) {
      w.strip.replaceChildren();
      for (const v of state.tabs[w.id]) {
        const tab = document.createElement('div');
        tab.className = 'rw-wtab';
        tab.dataset.view = v;
        tab.classList.toggle('active', state.active[w.id] === v);
        const grip = document.createElement('span');
        grip.className = 'rw-region-grip';
        grip.textContent = '⠿';
        const label = document.createElement('span');
        label.textContent = VIEW_LABELS[v];
        const close = document.createElement('span');
        close.className = 'rw-wtab-close';
        close.textContent = '✕';
        close.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        close.addEventListener('click', (ev) => {
          ev.stopPropagation();
          writeState(closeTab(currentState(), w.id, v));
        });
        tab.append(grip, label, close);
        attachTooltip(tab, 'Click to show this view; drag to reorder or move it to another window’s tab strip; ✕ closes it (reopen via any window’s +).');
        tab.addEventListener('pointerdown', (ev) => {
          if ((ev.target as HTMLElement).closest('.rw-wtab-close')) return;
          beginTabDrag(ev, w.id, v, tab);
        });
        w.strip.appendChild(tab);
      }
      w.shell.classList.toggle('rw-window-empty', state.tabs[w.id].length === 0);
    }
    publishLeftInset();
    // The RIGHT inset likewise tracks visibility: an empty/hidden right
    // window must publish 0 or the bottom strip's CSS (which stops at
    // `--rw-panel-inset-right`) stays truncated at the stale width —
    // the owner's Wide-layout bug. ControlPanel.publishInset keeps
    // owning live width changes while the window is visible.
    const rightEmpty = deps.panelShell.classList.contains('rw-window-empty');
    document.documentElement.style.setProperty(
      '--rw-panel-inset-right',
      rightEmpty ? '0px' : `${deps.panelShell.getBoundingClientRect().width}px`,
    );
  }

  // ------------------- tab drag (strip targets only) -----------------
  // One mechanism, one target kind (owner feedback): a dragged tab
  // drops ONLY onto a window's tab strip. While a drag is live, empty
  // (hidden) windows reveal themselves as labeled drop strips so they
  // stay reachable.
  const DRAG_THRESHOLD = 6;

  /** Window whose TAB BAR is under the pointer. */
  function stripWindowAt(x: number, y: number): WindowId | null {
    for (const w of windows.values()) {
      const r = w.bar.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return w.id;
    }
    return null;
  }

  /** For empty (hidden) windows only: which one's dock area is near the
   *  pointer. Proximity-based, one at a time (owner feedback) — occupied
   *  windows are targeted via their visible tab strips instead. */
  function emptyWindowAt(x: number, y: number, state: TabsState): WindowId | null {
    const vw = window.innerWidth, vh = window.innerHeight;
    const empty = (id: WindowId): boolean => state.tabs[id].length === 0;
    if (empty('left') && x < vw * 0.15) return 'left';
    if (empty('right') && x > vw * 0.85) return 'right';
    if (empty('bottom') && y > vh * 0.78) return 'bottom';
    if (empty('center') && x > vw * 0.3 && x < vw * 0.7 && y > vh * 0.3 && y < vh * 0.7) return 'center';
    return null;
  }

  /** Insertion index within a strip from the pointer's x position. */
  function stripIndexAt(win: Win, x: number): number {
    const tabs = Array.from(win.strip.querySelectorAll<HTMLElement>('.rw-wtab'));
    let idx = 0;
    for (const t of tabs) {
      const r = t.getBoundingClientRect();
      if (x > r.left + r.width / 2) idx++;
    }
    return idx;
  }

  function beginTabDrag(ev: PointerEvent, from: WindowId, view: ViewId, tabEl: HTMLElement): void {
    const startX = ev.clientX, startY = ev.clientY;
    const pid = ev.pointerId;
    let started = false;
    let ghost: HTMLElement | null = null;
    let hoverStrip: WindowId | null = null;
    let hoverEmpty: WindowId | null = null;
    let dropX = startX;

    const start = (): void => {
      started = true;
      if (maximized) toggleMaximize(maximized);
      ghost = document.createElement('div');
      ghost.className = 'rw-drag-ghost';
      ghost.textContent = VIEW_LABELS[view];
      document.body.appendChild(ghost);
      document.body.classList.add('rw-region-dragging');
    };

    const setEmptyReveal = (id: WindowId | null): void => {
      for (const w of windows.values()) {
        w.shell.classList.toggle('rw-drop-reveal', w.id === id);
      }
    };

    // Insertion caret: a thin line that nudges itself between tabs to
    // show exactly where the drop will land (owner feedback).
    const caret = document.createElement('span');
    caret.className = 'rw-wtab-caret';
    let caretAt: { win: WindowId; index: number } | null = null;
    const setCaret = (win: WindowId | null, index: number): void => {
      if (!win) {
        caret.remove();
        caretAt = null;
        return;
      }
      if (caretAt && caretAt.win === win && caretAt.index === index) return;
      const strip = windows.get(win)?.strip;
      if (!strip) return;
      const tabs = strip.querySelectorAll('.rw-wtab');
      if (index >= tabs.length) strip.appendChild(caret);
      else strip.insertBefore(caret, tabs[index]);
      caretAt = { win, index };
    };

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        start();
      }
      e.preventDefault();
      dropX = e.clientX;
      if (ghost) {
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY + 12}px`;
      }
      hoverStrip = stripWindowAt(e.clientX, e.clientY);
      hoverEmpty = hoverStrip ? null : emptyWindowAt(e.clientX, e.clientY, currentState());
      for (const w of windows.values()) {
        w.bar.classList.toggle('rw-strip-hover', w.id === hoverStrip);
      }
      setEmptyReveal(hoverEmpty);
      const hw = hoverStrip ? windows.get(hoverStrip) : null;
      setCaret(hoverStrip, hw ? stripIndexAt(hw, e.clientX) : 0);
    };
    const finish = (apply: boolean): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      ghost?.remove();
      document.body.classList.remove('rw-region-dragging');
      for (const w of windows.values()) w.bar.classList.remove('rw-strip-hover');
      setEmptyReveal(null);
      setCaret(null, 0);
      if (!apply) { window.dispatchEvent(new Event('rw:layout-resize')); return; }
      if (!started) {
        // Plain click: activate the tab.
        writeState(activateTab(currentState(), from, view));
        return;
      }
      const target = hoverStrip ?? hoverEmpty;
      if (target) {
        const win = windows.get(target);
        const index = hoverStrip && win ? stripIndexAt(win, dropX) : undefined;
        writeState(moveView(currentState(), view, target, index, from));
        // Dropping into a stowed window must produce a VISIBLE window.
        if (target === 'bottom' && settings.get('timelineDock') === 'hidden') {
          settings.set('timelineDock', settings.get('timelineLastDock'));
        }
        if (target === 'right' && settings.get('panelCollapsed')) {
          settings.set('panelCollapsed', false);
        }
      }
      window.dispatchEvent(new Event('rw:layout-resize'));
    };
    const onUp = (e: PointerEvent): void => { if (e.pointerId === pid) finish(true); };
    const onCancel = (e: PointerEvent): void => { if (e.pointerId === pid) finish(false); };
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    void tabEl;
  }

  // ------------------------- hosting --------------------------------
  function mount(win: Win, view: ViewId): void {
    if (win.mounted === view) return;
    if (win.mounted) {
      const prev = elementFor(win.mounted, win.id);
      if (prev) park.appendChild(prev);
      win.mounted = null;
    }
    const el = elementFor(view, win.id);
    // A late-registering view (the patch bay factory loads async) must
    // NOT mark the window as mounted — registerView's refresh() retries
    // and succeeds once the factory exists. (Bug: the bay's window
    // stayed empty forever because mounted was set with no element.)
    if (!el) return;
    win.shell.appendChild(el);
    win.mounted = view;
    win.shell.dataset.regionView = view;
    if (win.id === 'center') {
      win.shell.classList.toggle('rw-center-passthrough', view === 'renderer');
    }
  }

  function applyState(state: TabsState): void {
    renderStrips(state);
    // Park mismatched views first, then mount actives.
    for (const w of windows.values()) {
      const want = state.active[w.id];
      if (w.mounted && w.mounted !== want) {
        const prev = elementFor(w.mounted, w.id);
        if (prev) park.appendChild(prev);
        w.mounted = null;
      }
    }
    for (const w of windows.values()) {
      const want = state.active[w.id];
      if (want) mount(w, want);
      else {
        w.shell.dataset.regionView = '';
        if (w.id === 'center') w.shell.classList.add('rw-center-passthrough');
      }
    }
    // Renderer instances: passthrough only as the center's active tab;
    // mirror when active elsewhere; streams off when not mounted.
    for (const w of WINDOW_IDS) {
      const key = `renderer:${w}`;
      if (!rendererInstances.has(key)) continue;
      const active = state.active[w] === 'renderer' && windows.has(w) && !transientHidden(w, state);
      setRendererInstanceMode(key, !active ? 'off' : w === 'center' ? 'passthrough' : 'mirror');
    }
    window.dispatchEvent(new Event('rw:layout-resize'));
  }

  /** A window whose shell is hidden shows nothing (zero tabs elsewhere). */
  function transientHidden(w: WindowId, state: TabsState): boolean {
    return state.tabs[w].length === 0;
  }

  function refresh(): void {
    applyState(transientDefaults ? CLASSIC_TABS : currentState());
  }

  settings.subscribe('workspaceTabs', refresh);
  settings.subscribe('workspaceActive', refresh);

  layout.onModeChange((mode) => {
    transientDefaults = mode === 'compact' || popoutOpen;
    refresh();
  });

  deps.leftShell.style.width = `${Math.max(220, Math.min(1400, settings.get('leftPanelWidth')))}px`;
  refresh();

  return {
    attachDockRegion(dockShell: HTMLElement, timelineViewEl: HTMLElement): void {
      singletonEls.set('timeline', timelineViewEl);
      if (!windows.has('bottom')) buildWindow('bottom', dockShell);
      refresh();
    },
    registerView(id: ViewId, el: HTMLElement | (() => HTMLElement)): void {
      if (typeof el === 'function') factories.set(id, el);
      else singletonEls.set(id, el);
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
      writeState(p.state);
      settings.set('panelCollapsed', p.panelCollapsed);
      settings.set('panelWidth', p.panelWidth);
      settings.set('leftPanelWidth', p.leftPanelWidth);
      settings.set('timelineDock', p.timelineDock);
      settings.set('timelineHeight', p.timelineHeight);
    },
    getState: currentState,
    moveViewTo(view: ViewId, win: WindowId): void {
      writeState(moveView(currentState(), view, win));
    },
  };
}
