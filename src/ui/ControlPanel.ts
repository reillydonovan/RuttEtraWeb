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
    settings.subscribe('panelDock', (v) => this.root.setAttribute('data-dock', v));

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
