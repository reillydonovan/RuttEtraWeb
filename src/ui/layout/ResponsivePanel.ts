/**
 * Wraps `ControlPanel` and decides how to present its sections based on the
 * current `LayoutMode`:
 *
 *   - expansive / standard → existing side-panel rendering, untouched
 *   - compact              → hide the side panel; mount #top-strip + #tab-bar
 *                            and re-parent section wrappers into BottomSheet
 *                            instances on demand
 *
 * Section files stay layout-agnostic — they still produce the same DOM via
 * `controlPanel.addSection(...)`. We just move the wrappers around.
 */

import { ControlPanel } from '../ControlPanel';
import { SettingsStore } from '../../state/Settings';
import { LayoutManager, LayoutMode } from './LayoutManager';
import { BottomSheet } from './BottomSheet';
import { TabBar, TabBarTabId } from './TabBar';
import { TopStrip } from './TopStrip';
import { CaptureDock, CaptureDockDeps } from './CaptureDock';
import { buildSourceQuick } from './SourceQuick';
import { SheetPreview } from './SheetPreview';
import { COMPACT_TABS, CompactTabSpec } from './LayoutGroups';

export interface ResponsivePanelDeps {
  /** Triggered by top strip "REC" button. */
  onToggleRecord:    () => void;
  /** Triggered by top strip "BC" button. */
  onToggleBroadcast: () => void;
  /** Phone capture dock (looks + shutter). Omit and compact mode has no dock. */
  dock?: CaptureDockDeps;
}

export class ResponsivePanel {
  private settings: SettingsStore;
  private layout: LayoutManager;
  private panel: ControlPanel;
  private deps: ResponsivePanelDeps;

  // Compact-mode chrome (created lazily on first compact mount).
  private topStrip: TopStrip | null = null;
  private tabBar: TabBar | null = null;
  private dock: CaptureDock | null = null;
  private sheetDisposers: Array<() => void> = [];
  /** Live picture-in-picture of the render while a tab sheet covers it. */
  private preview: SheetPreview | null = null;
  /** Sheet currently presenting compact tab content, if any. */
  private activeSheet: BottomSheet | null = null;
  /** Container the sheet's content panel re-parents to when dismissed. */
  private detached: HTMLElement;

  /** Toast host (used by FrameBudgetWatcher). */
  private toastHost: HTMLElement;

  /** Resolves once the Help/Manual section is mounted into the panel. */
  private helpReadyFlag = false;
  private helpReady: Promise<void>;
  private helpResolve!: () => void;

  constructor(
    panel: ControlPanel,
    settings: SettingsStore,
    layout: LayoutManager,
    deps: ResponsivePanelDeps,
  ) {
    this.panel = panel;
    this.settings = settings;
    this.layout = layout;
    this.deps = deps;

    this.detached = document.createElement('div');
    this.detached.id = 'rw-detached';
    this.detached.style.display = 'none';
    document.body.appendChild(this.detached);

    this.toastHost = document.createElement('div');
    this.toastHost.id = 'rw-toast-host';
    document.body.appendChild(this.toastHost);

    this.helpReady = new Promise<void>((resolve) => { this.helpResolve = resolve; });

    layout.onModeChange((m) => this.applyMode(m));
  }

  /** Apply visual changes for a layout mode. */
  applyMode(mode: LayoutMode): void {
    document.body.dataset.layout = mode;

    if (mode === 'compact') {
      this.enterCompact();
    } else {
      this.exitCompact();
    }
  }

  /** Show a transient toast (used by FrameBudgetWatcher etc.). */
  toast(message: string, action?: { label: string; onClick: () => void }, durationMs = 8000): void {
    const t = document.createElement('div');
    t.className = 'rw-toast';
    const msg = document.createElement('span');
    msg.textContent = message;
    t.appendChild(msg);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-toast-btn';
      b.textContent = action.label;
      b.addEventListener('click', () => {
        action.onClick();
        t.remove();
      });
      t.appendChild(b);
    }
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'rw-toast-dismiss rw-x rw-x--s';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => t.remove());
    t.appendChild(dismiss);
    this.toastHost.appendChild(t);
    setTimeout(() => t.remove(), durationMs);
  }

  // ----------------------------------------------------------- compact mode

  private enterCompact(): void {
    // Hide the side panel; sections still live inside its DOM (we'll move
    // them into sheets on demand).
    this.panel.root.classList.add('compact-hidden');

    // Top strip.
    if (!this.topStrip) {
      this.topStrip = new TopStrip({
        onOpenPresets:    () => this.openSheetForTab('more'),  // Presets group lives in More tab now
        onToggleRecord:   () => this.deps.onToggleRecord(),
        onToggleBroadcast:() => this.deps.onToggleBroadcast(),
        onOpenHelp:       () => this.openHelp(),
      });
    }
    if (!document.getElementById('top-strip')) {
      document.body.insertBefore(this.topStrip.el, document.body.firstChild);
    }

    // Capture dock (looks carousel + shutter), floating above the tab bar.
    if (!this.dock && this.deps.dock) this.dock = new CaptureDock(this.deps.dock);
    if (this.dock && !document.getElementById('capture-dock')) document.body.appendChild(this.dock.el);

    // Tab bar.
    if (!this.tabBar) {
      this.tabBar = new TabBar(COMPACT_TABS, (id) => this.openSheetForTab(id));
    }
    if (!document.getElementById('tab-bar')) {
      document.body.appendChild(this.tabBar.el);
    }
  }

  private exitCompact(): void {
    this.panel.root.classList.remove('compact-hidden');

    // Reattach any sections currently parked in a sheet back into the panel.
    if (this.activeSheet) {
      this.reparkActiveSheetSections();
      this.activeSheet.dismiss();
      this.activeSheet = null;
    } else {
      // Nothing in a sheet; ensure all known sections live where they should.
      for (const title of this.panel.sectionTitles()) {
        this.panel.reattachSection(title);
      }
    }

    // Remove compact chrome.
    document.getElementById('top-strip')?.remove();
    document.getElementById('tab-bar')?.remove();
    document.getElementById('capture-dock')?.remove();
    if (this.tabBar) this.tabBar.setActive(null);
  }

  /** Open the sheet for a given compact tab id. */
  openSheetForTab(id: TabBarTabId): void {
    const tab = COMPACT_TABS.find((t) => t.id === id);
    if (!tab) return;
    if (this.activeSheet) {
      this.reparkActiveSheetSections();
      this.activeSheet.dismiss();
      this.activeSheet = null;
    }
    this.tabBar?.setActive(id);

    const content = this.collectSectionsForTab(tab);
    const sheet = new BottomSheet({
      title: tab.label.toUpperCase(),
      initialSnap: tab.id === 'more' ? '90' : '60',
      onDismiss: () => {
        this.preview?.hide();
        this.reparkActiveSheetSections();
        this.activeSheet = null;
        this.tabBar?.setActive(null);
      },
      // Pulled down to the lowest snap the picture itself shows — no need for the preview.
      onSnapChange: (snap) => this.preview?.setSuppressed(snap === '30'),
    });
    sheet.open(content);
    this.activeSheet = sheet;
    const stage = document.getElementById('stage');
    if (stage instanceof HTMLCanvasElement) (this.preview ??= new SheetPreview(stage)).show();
  }

  /** Called by main.ts when the (lazy-loaded) Manual section is in place. */
  notifyHelpReady(): void {
    if (this.helpReadyFlag) return;
    this.helpReadyFlag = true;
    this.helpResolve();
  }

  /** Open a dedicated Help sheet — separate from the More tab so the user
   *  doesn't have to scroll past Camera/Presets/Record/Share to find it. */
  async openHelp(): Promise<void> {
    this.settings.set('panelTab', 'help');
    if (this.activeSheet) {
      this.reparkActiveSheetSections();
      this.activeSheet.dismiss();
      this.activeSheet = null;
    }
    this.tabBar?.setActive(null);

    // Build a placeholder + sheet immediately so the tap feels responsive.
    const container = document.createElement('div');
    container.className = 'rw-sheet-sections';
    const loading = document.createElement('div');
    loading.className = 'rw-hint';
    loading.textContent = 'Loading help…';
    container.appendChild(loading);

    const sheet = new BottomSheet({
      title: 'HELP',
      initialSnap: '90',
      onDismiss: () => {
        this.reparkActiveSheetSections();
        this.activeSheet = null;
      },
    });
    sheet.open(container);
    this.activeSheet = sheet;

    // Wait for the lazy-loaded help section to be mounted, then swap in.
    if (!this.helpReadyFlag) await this.helpReady;
    if (this.activeSheet !== sheet) return; // user dismissed while loading
    const wrap = this.panel.getSection('Manual');
    if (wrap) {
      loading.remove();
      wrap.classList.remove('collapsed');
      container.appendChild(wrap);
      sheet.setContent(container);
    } else {
      loading.textContent = 'Help unavailable. Reload the page if this persists.';
    }
  }

  setRecordingIndicator(on: boolean): void { this.topStrip?.setRecording(on); }
  setBroadcastIndicator(on: boolean): void { this.topStrip?.setBroadcasting(on); }
  /** Highlight a look in the capture dock's carousel (null clears it). */
  setActiveLook(id: string | null): void { this.dock?.setActiveLook(id); }
  /** Offer the native share sheet for a just-saved recording. */
  offerShare(file: File): void { this.dock?.offerShare(file); }

  // ---------------------------------------------------------- internals

  private collectSectionsForTab(tab: CompactTabSpec): HTMLElement {
    const container = document.createElement('div');
    container.className = 'rw-sheet-sections';
    if (tab.id === 'source' && this.deps.dock?.quickSource) {
      const q = buildSourceQuick(this.settings, this.deps.dock.quickSource, (m) => this.toast(m));
      this.sheetDisposers.push(q.dispose);
      container.appendChild(q.el);
    }
    for (const title of tab.sections) {
      const wrap = this.panel.getSection(title);
      if (!wrap) continue;
      // Park the section in this container; we'll reattach on dismiss.
      container.appendChild(wrap);
      // Force expanded in compact (collapsed sections look weird in a sheet).
      wrap.classList.remove('collapsed');
    }
    return container;
  }

  /** Move any sections currently inside the active sheet back to the panel. */
  private reparkActiveSheetSections(): void {
    for (const d of this.sheetDisposers.splice(0)) d();
    for (const title of this.panel.sectionTitles()) {
      this.panel.reattachSection(title);
    }
  }
}
