/**
 * The collapsible side panel that hosts every control section.
 *
 * Sections are added via `addSection({ tab, title, body, ... })` and rendered
 * as a vertical accordion within the chosen tab. The panel itself can dock
 * left or right and collapse to a thin strip — useful when recording or
 * streaming so the UI doesn't compete with the canvas.
 *
 * v2 adds a tab strip (Synth / I/O) above the body. The active tab is
 * persisted to `settings.panelTab`.
 */

import './panel.css';
import { SettingsStore } from '../state/Settings';

export type TabId = 'synth' | 'io' | 'help';

export interface PanelSection {
  title: string;
  body: HTMLElement;
  initiallyOpen?: boolean;
  tab?: TabId;
}

interface TabPane {
  id: TabId;
  label: string;
  button: HTMLButtonElement;
  pane: HTMLElement;
}

export class ControlPanel {
  readonly root: HTMLElement;
  private bodyHost: HTMLElement;
  private tabsBar: HTMLElement;
  private tabPanes: Record<TabId, TabPane>;
  private activeTab: TabId;
  private collapsed = false;
  /** Section wrapper elements indexed by title (used by ResponsivePanel). */
  private sectionsByTitle = new Map<string, HTMLElement>();
  /** Original tab assignment for each section title (so a re-parent can restore it). */
  private sectionTab = new Map<string, TabId>();
  private actionsBar!: HTMLElement;

  /** Add a custom button to the title-bar action strip (before dock/collapse). */
  addTitleAction(btn: HTMLButtonElement): void {
    this.actionsBar.insertBefore(btn, this.actionsBar.firstChild);
  }

  /** Insert an element between the title bar and the tab strip
   *  (used by the panel-wide param search). */
  addBeforeTabs(el: HTMLElement): void {
    this.root.insertBefore(el, this.tabsBar);
  }

  constructor(host: HTMLElement, private settings: SettingsStore) {
    this.root = host;
    this.root.setAttribute('data-dock', settings.get('panelDock'));
    if (settings.get('panelCollapsed')) this.root.classList.add('collapsed');

    const title = document.createElement('div');
    title.className = 'rw-panel-title';

    const titleText = document.createElement('div');
    titleText.className = 'rw-panel-title-text';
    titleText.textContent = 'RUTT/ETRA';
    title.appendChild(titleText);

    // Build stamp — answers "which version is live?" at a glance. Also
    // logged to the console for bug reports from the field.
    const build = document.createElement('div');
    build.className = 'rw-panel-build';
    build.textContent = `v${__BUILD_INFO__.version} · ${__BUILD_INFO__.commit}`;
    build.title = `Built ${__BUILD_INFO__.builtAt} from commit ${__BUILD_INFO__.commit}`;
    title.appendChild(build);
    // eslint-disable-next-line no-console
    console.info(`[ruttetra] v${__BUILD_INFO__.version} ${__BUILD_INFO__.commit} (${__BUILD_INFO__.builtAt})`);

    const actions = document.createElement('div');
    actions.className = 'rw-panel-actions';

    const dockBtn = document.createElement('button');
    dockBtn.title = 'Toggle dock side';
    dockBtn.textContent = '↔';
    dockBtn.addEventListener('click', () => {
      const next = settings.get('panelDock') === 'right' ? 'left' : 'right';
      settings.set('panelDock', next);
    });
    settings.subscribe('panelDock', (v) => {
      this.root.setAttribute('data-dock', v);
      this.publishInset();
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.title = 'Collapse panel';
    collapseBtn.textContent = '–';
    collapseBtn.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      settings.set('panelCollapsed', this.collapsed);
      collapseBtn.textContent = this.collapsed ? '+' : '–';
    });
    settings.subscribe('panelCollapsed', (v) => {
      this.collapsed = !!v;
      this.root.classList.toggle('collapsed', this.collapsed);
      collapseBtn.textContent = this.collapsed ? '+' : '–';
      this.publishInset();
    });

    actions.append(dockBtn, collapseBtn);
    title.appendChild(actions);
    this.actionsBar = actions;

    // Tab strip
    const tabs = document.createElement('div');
    tabs.className = 'rw-tabs';
    this.tabsBar = tabs;

    const body = document.createElement('div');
    body.className = 'rw-panel-body';
    this.bodyHost = body;

    this.activeTab = settings.get('panelTab') || 'synth';
    this.tabPanes = {
      synth: this.makeTab('synth', 'Synth'),
      io:    this.makeTab('io',    'I/O'),
      help:  this.makeTab('help',  'Help'),
    };
    for (const id of ['synth', 'io', 'help'] as TabId[]) {
      tabs.appendChild(this.tabPanes[id].button);
      body.appendChild(this.tabPanes[id].pane);
    }
    this.applyActiveTab();

    // Always re-apply on every change. We deliberately don't early-return on
    // `v === this.activeTab` because external callers (e.g. the help FAB,
    // ResponsivePanel) may set the same value to *force* a re-sync if the
    // visual state has drifted.
    settings.subscribe('panelTab', (v) => {
      if (!v) return;
      this.activeTab = v;
      this.applyActiveTab();
    });

    this.root.append(title, tabs, body);

    // Width resize: drag the panel's inner edge (left edge when docked
    // right, right edge when docked left). Applied via a CSS custom
    // property so the collapsed / popout width rules still win.
    this.root.appendChild(this.buildWidthResizeHandle());
    // Fires immediately with the persisted value, then on every change.
    settings.subscribe('panelWidth', (w) => this.applyPanelWidth(w));
  }

  // -----------------------------------------------------------------
  // Panel width resize (clamped 280–600, persisted as Settings.panelWidth)
  // -----------------------------------------------------------------

  private static readonly WIDTH_MIN = 280;
  private static readonly WIDTH_MAX = 600;

  private applyPanelWidth(w: number): void {
    const clamped = Math.max(ControlPanel.WIDTH_MIN, Math.min(ControlPanel.WIDTH_MAX, w));
    this.root.style.setProperty('--panel-w', `${clamped}px`);
    this.publishInset(clamped);
  }

  /**
   * Publish the panel's current viewport footprint as CSS insets on the
   * document root, so viewport-pinned siblings (the timeline dock) can
   * stop at the panel's inner edge instead of hiding underneath it.
   * Publishes to the panel's OWN document: in the popout that's the
   * popup (harmless), and main.ts zeroes the main window's insets on
   * pop-out / recomputes them on pop-in via refreshInset().
   */
  private publishInset(width?: number): void {
    const style = this.root.ownerDocument.documentElement.style;
    const w = this.collapsed
      ? 40
      : Math.max(ControlPanel.WIDTH_MIN, Math.min(
          ControlPanel.WIDTH_MAX, width ?? this.settings.get('panelWidth')));
    const side = this.settings.get('panelDock');
    style.setProperty('--rw-panel-inset-right', side === 'right' ? `${w}px` : '0px');
    style.setProperty('--rw-panel-inset-left',  side === 'left'  ? `${w}px` : '0px');
  }

  /** Recompute the insets (main.ts calls this when the popout returns). */
  refreshInset(): void {
    this.publishInset();
  }

  private buildWidthResizeHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'rw-panel-resize';
    handle.title = 'Drag to resize the panel';
    handle.addEventListener('pointerdown', (ev) => {
      if (this.collapsed) return;
      ev.preventDefault();
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add('active');
      const startX = ev.clientX;
      const startW = Math.max(ControlPanel.WIDTH_MIN, Math.min(
        ControlPanel.WIDTH_MAX, this.settings.get('panelWidth')));
      // Docked right: dragging LEFT widens. Docked left: dragging right.
      const sign = this.settings.get('panelDock') === 'left' ? 1 : -1;
      let lastW = startW;
      // ownerDocument, not the module-scope document — the panel can live
      // in the two-screen popout window.
      const doc = handle.ownerDocument;
      const win = doc.defaultView ?? window;
      const onMove = (mv: PointerEvent): void => {
        lastW = Math.max(ControlPanel.WIDTH_MIN, Math.min(
          ControlPanel.WIDTH_MAX, startW + sign * (mv.clientX - startX)));
        this.applyPanelWidth(lastW);
      };
      const onUp = (mv: PointerEvent): void => {
        handle.releasePointerCapture?.(mv.pointerId);
        handle.classList.remove('active');
        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onUp);
        // Persist once per gesture, not per pixel.
        this.settings.set('panelWidth', Math.round(lastW));
      };
      win.addEventListener('pointermove', onMove);
      win.addEventListener('pointerup', onUp);
    });
    return handle;
  }

  addSection(section: PanelSection): HTMLElement {
    const tabId: TabId = section.tab ?? 'synth';
    const wrap = document.createElement('div');
    wrap.className = 'rw-section';
    if (!section.initiallyOpen) wrap.classList.add('collapsed');

    const head = document.createElement('div');
    head.className = 'rw-section-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = section.title;
    const chev = document.createElement('span');
    chev.className = 'rw-chev';
    chev.textContent = '▾';
    head.append(titleSpan, chev);

    const body = document.createElement('div');
    body.className = 'rw-section-body';
    body.appendChild(section.body);

    head.addEventListener('click', () => wrap.classList.toggle('collapsed'));

    wrap.append(head, body);
    this.tabPanes[tabId].pane.appendChild(wrap);
    this.sectionsByTitle.set(section.title, wrap);
    this.sectionTab.set(section.title, tabId);
    return wrap;
  }

  /** Look up a section wrapper by title (used by ResponsivePanel for re-parenting). */
  getSection(title: string): HTMLElement | null {
    return this.sectionsByTitle.get(title) ?? null;
  }

  /** Re-attach a previously detached section back into its original tab pane. */
  reattachSection(title: string): void {
    const wrap = this.sectionsByTitle.get(title);
    const tab  = this.sectionTab.get(title);
    if (!wrap || !tab) return;
    if (wrap.parentElement === this.tabPanes[tab].pane) return;
    this.tabPanes[tab].pane.appendChild(wrap);
  }

  /** All known section titles in registration order. */
  sectionTitles(): string[] {
    return Array.from(this.sectionsByTitle.keys());
  }

  // -------------------- internals --------------------

  private makeTab(id: TabId, label: string): TabPane {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rw-tab';
    button.textContent = label;
    button.dataset.tab = id;
    // Use both pointerup (snappy on desktop) and click (keyboard activation,
    // accessibility). The click handler is the source of truth and always
    // re-applies state — even if `activeTab === id` already — so a "stuck"
    // visual state can be unstuck by re-clicking the same tab.
    const handle = (ev: Event): void => {
      ev.preventDefault();
      this.activeTab = id;
      this.settings.set('panelTab', id);
      this.applyActiveTab();
    };
    button.addEventListener('click', handle);
    const pane = document.createElement('div');
    pane.className = 'rw-tab-pane';
    return { id, label, button, pane };
  }

  private applyActiveTab(): void {
    for (const t of Object.values(this.tabPanes)) {
      const isActive = t.id === this.activeTab;
      t.button.classList.toggle('active', isActive);
      t.pane.classList.toggle('active', isActive);
    }
  }
}
