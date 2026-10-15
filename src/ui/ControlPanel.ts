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
import { attachTooltip } from './tooltip';
import { attachEdgeScrollbars } from './patchbay/edgeScrollbars';
import { SECTION_HINTS } from './help/sectionHints';
import { infoButton } from './help/infoModal';
import { sectionInfo } from './help/infoContent';
import { flowStateOf, paramsFlow } from './help/signalFlow';
import { SkinId, setSkin, subscribeSkin } from './skin';
import { ThemeId, setTheme, subscribeTheme } from './theme';
import { runAction } from './actions';

export type TabId = 'synth' | 'io' | 'help';

export interface PanelSection {
  title: string;
  body: HTMLElement;
  initiallyOpen?: boolean;
  tab?: TabId;
  /** Keep this section first in its tab even if it's added late
   *  (lazily loaded sections are otherwise appended at the bottom). */
  pinTop?: boolean;
}

interface TabPane {
  id: TabId;
  label: string;
  button: HTMLButtonElement;
  pane: HTMLElement;
}

export class ControlPanel {
  readonly root: HTMLElement;
  /**
   * The panel's movable CONTENT (title bar, tabs, body) — everything
   * except shell chrome (width handle, collapse strip), which stays on
   * `root` (#panel-root). The workspace region system re-parents this
   * element to host the Controls view in another region; PanelPopout
   * still adopts the whole shell.
   */
  readonly viewRoot: HTMLElement;
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
    this.viewRoot.insertBefore(el, this.tabsBar);
  }

  constructor(host: HTMLElement, private settings: SettingsStore) {
    this.root = host;
    this.viewRoot = document.createElement('div');
    this.viewRoot.className = 'rw-panel-view';
    this.root.appendChild(this.viewRoot);
    this.root.setAttribute('data-dock', settings.get('panelDock'));
    if (settings.get('panelCollapsed')) this.root.classList.add('collapsed');

    const title = document.createElement('div');
    title.className = 'rw-panel-title';

    const titleText = document.createElement('div');
    titleText.className = 'rw-panel-title-text';
    titleText.textContent = 'RUTT/ETRA WEB';
    title.appendChild(titleText);

    // Build stamp — answers "which version is live?" at a glance. Also
    // logged to the console for bug reports from the field.
    const build = document.createElement('div');
    build.className = 'rw-panel-build';
    // Version and commit as separate spans: the version always shows (the
    // owner tracks builds by it); the commit may give way when it's tight.
    const ver = document.createElement('span');
    ver.className = 'rw-panel-build-ver';
    ver.textContent = `v${__BUILD_INFO__.version}`;
    const sha = document.createElement('span');
    sha.className = 'rw-panel-build-sha';
    sha.textContent = ` · ${__BUILD_INFO__.commit}`;
    build.append(ver, sha);
    build.title = `Built ${__BUILD_INFO__.builtAt} from commit ${__BUILD_INFO__.commit}`;
    title.appendChild(build);
    // eslint-disable-next-line no-console
    console.info(`[ruttetra] v${__BUILD_INFO__.version} ${__BUILD_INFO__.commit} (${__BUILD_INFO__.builtAt})`);

    const actions = document.createElement('div');
    actions.className = 'rw-panel-actions';

    // Skin picker — flat CRT / skeuomorphic hardware / full rack with
    // patch cables. A local UI preference (localStorage via skin.ts),
    // deliberately NOT a Settings key: loading a patch must never
    // restyle the panel.
    const skinSel = document.createElement('select');
    skinSel.className = 'rw-skin-select';
    for (const [value, label] of [['standard', 'CRT'], ['hardware', 'HW'], ['rack', 'RACK']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      skinSel.appendChild(opt);
    }
    skinSel.addEventListener('change', () => setSkin(skinSel.value as SkinId));
    subscribeSkin((s) => {
      skinSel.value = s;
      skinSel.classList.toggle('active', s !== 'standard');
    });
    attachTooltip(skinSel, 'Panel skin: flat CRT, hardware (knobs and switches), or full rack with patch cables. Remembered on this machine, not in your patches.');

    // Theme picker — Modern (default) / Classic (the original phosphor CRT). Independent of the skin;
    // also a local preference (theme.ts), not a Settings key.
    const themeSel = document.createElement('select');
    themeSel.className = 'rw-skin-select rw-theme-select';
    for (const [value, label] of [['modern', 'MODERN'], ['phosphor', 'CLASSIC']] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      themeSel.appendChild(opt);
    }
    themeSel.addEventListener('change', () => { if (!runAction(`view.theme.${themeSel.value}`)) setTheme(themeSel.value as ThemeId); });
    subscribeTheme((t) => {
      themeSel.value = t;
      themeSel.classList.toggle('active', t !== 'modern');   // lit when not on the default
    });
    attachTooltip(themeSel, 'Visual theme: Modern (the default: neutral greys, rounded, soft glow) or Classic (the original green phosphor CRT). Works with any skin. Remembered on this machine, not in your patches.');

    // (The old ↔ dock-side toggle is gone: since the v31 tab model the
    // panel shell IS the right window — the left side belongs to the
    // left workspace window; drag tabs there instead.)
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

    actions.append(skinSel, themeSel, collapseBtn);
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

    // The same scroll control as the Patch Bay (owner: continuity) — rails
    // that reveal near the right edge, a draggable thumb with the axis
    // cursor, track click pages. Re-synced whenever the body or a tab
    // pane changes size (tab switch, a section opening).
    const rails = attachEdgeScrollbars(body);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => rails.update());
      ro.observe(body);
      for (const id of ['synth', 'io', 'help'] as TabId[]) ro.observe(this.tabPanes[id].pane);
    }

    // Always re-apply on every change. We deliberately don't early-return on
    // `v === this.activeTab` because external callers (e.g. the help FAB,
    // ResponsivePanel) may set the same value to *force* a re-sync if the
    // visual state has drifted.
    settings.subscribe('panelTab', (v) => {
      if (!v) return;
      this.activeTab = v;
      this.applyActiveTab();
    });

    this.viewRoot.append(title, tabs, body);

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

  private static readonly WIDTH_MIN = 220;
  private static readonly WIDTH_MAX = 1400;

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
    // Since the v31 tab model the panel shell is the RIGHT window
    // (panelDock is forced 'right'); the LEFT inset var belongs to the
    // left workspace window and must not be stomped from here. A hidden
    // (zero-tab) window publishes 0 — otherwise a preset that writes
    // panelWidth AFTER emptying the window re-truncates the bottom
    // strip at a stale inset (the owner's Wide-layout bug).
    const hidden = this.root.classList.contains('rw-window-empty');
    style.setProperty('--rw-panel-inset-right', hidden ? '0px' : `${w}px`);
    // Let the render canvas track the panel's footprint live, mid-drag
    // — not just once the width commits to Settings on release. Bare
    // `window` (not `this.root.ownerDocument.defaultView`): this
    // controller always runs in the MAIN window's JS context even when
    // its DOM is adopted into the popout, and main.ts's listener lives
    // there too.
    window.dispatchEvent(new Event('rw:layout-resize'));
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
    // ⓘ — opens this section's reference (keys gathered at click time,
    // so controls added after construction are included).
    const info = infoButton(() => {
      const keys = Array.from(wrap.querySelectorAll<HTMLElement>('[data-param-key]'), (n) => n.dataset.paramKey!);
      const c = sectionInfo(section.title, keys);
      return keys.length ? { ...c, flow: paramsFlow(flowStateOf(this.settings), section.title, keys) } : c;
    }, `About ${section.title}`);
    head.append(titleSpan, info, chev);
    const hint = SECTION_HINTS[section.title];
    if (hint) attachTooltip(head, hint);

    const body = document.createElement('div');
    body.className = 'rw-section-body';
    body.appendChild(section.body);

    head.addEventListener('click', () => wrap.classList.toggle('collapsed'));

    wrap.append(head, body);
    if (section.pinTop) wrap.dataset.pinTop = 'true';
    this.placeSection(this.tabPanes[tabId].pane, wrap);
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
    this.placeSection(this.tabPanes[tab].pane, wrap);
  }

  /** Append a section, or put a `pinTop` one before the first unpinned section. */
  private placeSection(pane: HTMLElement, wrap: HTMLElement): void {
    if (!wrap.dataset.pinTop) { pane.appendChild(wrap); return; }
    const firstUnpinned = Array.from(pane.children).find(
      (c) => c.classList.contains('rw-section') && !(c as HTMLElement).dataset.pinTop,
    );
    pane.insertBefore(wrap, firstUnpinned ?? null);
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
