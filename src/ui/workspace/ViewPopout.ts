/**
 * Generic view popout — open any workspace view as a standalone OS
 * window for multi-display rigs (owner: "drag something like the
 * timeline or patch bay to a separate window").
 *
 * Strategy: build a FRESH live instance of the view from its workspace
 * factory directly into the popup document — NOT DOM adoption. Every
 * view is multi-instance by design (Workspace.ts: duplicates sync via
 * the shared Settings/Sequencer stores), so a popout is just one more
 * instance that happens to live in another window. That sidesteps the
 * adoption hazards the dedicated popouts had to engineer around
 * (PanelPopout's placeholder dance, RenderPopout's never-move-live-GL
 * rule) and means closing the popup needs no restore step at all — the
 * in-app window never lost anything.
 *
 * CONTROLS and RENDERER don't come through here for their FIRST tab:
 * they keep their existing, more specialized popouts (PanelPopout
 * adopts the one live panel; RenderPopout captureStreams the one real
 * canvas) — the window bar's ⧉ dispatches to those actions instead
 * (Workspace.ts). Once a popup exists, though, its OWN [+] can add a
 * renderer/panel/timeline/patchbay tab freely — see below.
 *
 * The popup hosts a REAL, if small, tab bar (owner: "when I pop out a
 * window it should still have the tab bar at the top so I can add more
 * tabs") — reuses the same `.rw-region-bar`/`.rw-tabstrip`/`.rw-wtab`
 * markup and CSS the four in-document windows use, so it looks and
 * behaves like one more window, just in its own OS chrome. Its tab
 * LIST is local to the popup, not folded into the main document's
 * `workspaceTabs`/`workspaceActive` Settings state — cross-window
 * pointer-drag isn't a thing browsers support (pointer events don't
 * cross window boundaries), so reordering/dragging tabs OUT of a popup
 * back into the main document isn't offered; closing the popup's last
 * tab just closes the popup, matching an in-document window with zero
 * tabs disappearing.
 */

import { applySkinToDocument, releaseDocument } from '../skin';
import { applyTextScaleToDocument } from '../textScale';
import type { ViewId } from './workspaceModel';

const openPopups = new Map<string, Window>();

export function popoutView(opts: {
  /** The view this popup was opened FOR — also the dedup/focus key, so
   *  re-clicking the same window's ⧉ re-focuses this popup even if its
   *  tab list has since grown. */
  view: ViewId;
  /** This first tab's unique instance tag (see Workspace.ts). */
  tag: string;
  /** Popup title / first tab's label, e.g. 'PATCH BAY'. */
  label: string;
  /** The already-built first-tab element (Workspace.ts's
   *  `buildDetachedInstance(view, tag)`). */
  el: HTMLElement;
  /** Build one more fresh, fully-wired view instance under a given
   *  tag — the popup's own [+] uses this for every tab after the
   *  first. */
  buildInstance: (view: ViewId, tag: string) => HTMLElement | null;
  /** Mint a fresh globally-unique tag for a new tab. */
  nextTag: () => string;
  /** Which view kinds exist at all right now — filters the [+] menu. */
  listAvailableViews: () => ViewId[];
  viewLabels: Record<ViewId, string>;
}): boolean {
  const existing = openPopups.get(opts.view);
  if (existing && !existing.closed) { existing.focus(); return true; }

  const opened = window.open('', `ruttetra-view-${opts.view}`, 'popup=yes,width=900,height=700');
  if (!opened) return false; // popup blocked
  const w = opened; // re-bind: narrowing a `const` doesn't persist into hoisted function declarations below
  openPopups.set(opts.view, w);
  w.document.title = `RUTT/ETRA — ${opts.label}`;

  // Same stylesheet/skin/text-scale propagation as PanelPopout — this
  // is also how the popup gets `.rw-region-bar`/`.rw-wtab` styling for
  // free, no separate popup-specific CSS needed.
  const nodes = document.head.querySelectorAll('style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]');
  for (const n of Array.from(nodes)) w.document.head.appendChild(n.cloneNode(true));
  w.document.body.className = document.body.className;
  w.document.body.classList.add('rw-popout-body', 'rw-view-popout-body');
  applySkinToDocument(w.document);
  const unsubTextScale = applyTextScaleToDocument(w.document);

  // ---- local tab bar ----
  const bar = w.document.createElement('div');
  bar.className = 'rw-region-bar rw-popout-bar';
  const strip = w.document.createElement('div');
  strip.className = 'rw-tabstrip';
  const addBtn = w.document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'rw-region-btn rw-tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add a view to this window';
  const spacer = w.document.createElement('span');
  spacer.className = 'rw-region-bar-spacer';
  bar.append(strip, addBtn, spacer);

  const content = w.document.createElement('div');
  content.className = 'rw-popout-content';
  w.document.body.append(bar, content);

  interface Tab { view: ViewId; tag: string; el: HTMLElement; tabEl: HTMLElement }
  const tabs: Tab[] = [];
  let activeIndex = 0;

  function renderStrip(): void {
    // Strip buttons are cheap chrome — rebuilding them is fine. The tab
    // CONTENT is not: each is a live view (its own rAF loop, canvases,
    // ResizeObservers) — detaching and re-appending it on every click
    // (an earlier version did `content.innerHTML = ''` here) silently
    // broke the Patch Bay's cable canvas after a switch-away-and-back
    // (found live: module DOM was intact, sizes read correctly, but
    // nothing painted — a re-parent mid-session doesn't reliably
    // re-trigger whatever observer originally sized it). Content is
    // appended ONCE per tab, ever; switching only toggles visibility —
    // via inline `style.display`, NOT the `hidden` attribute/property:
    // `hidden` only hides through the UA stylesheet's `[hidden] {
    // display: none }` rule, which is the LOWEST-priority origin in the
    // cascade — any author rule setting `display` on the view's own
    // root (Timeline's dock root does) wins the cascade and the
    // "hidden" tab stays visibly rendered underneath the active one
    // (found live: closing the Timeline tab revealed its transport bar
    // had been painting the whole time, overlapping the Patch Bay
    // below it). An inline style always outranks a class rule.
    strip.innerHTML = '';
    tabs.forEach((t, i) => {
      const tabEl = w.document.createElement('div');
      tabEl.className = 'rw-wtab';
      tabEl.classList.toggle('active', i === activeIndex);
      const label = w.document.createElement('span');
      label.textContent = opts.viewLabels[t.view] ?? t.view;
      tabEl.appendChild(label);
      if (tabs.length > 1) {
        const close = w.document.createElement('span');
        close.className = 'rw-wtab-close';
        close.textContent = '✕';
        close.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => closeTab(i));
        tabEl.appendChild(close);
      }
      tabEl.addEventListener('click', () => { activeIndex = i; renderStrip(); });
      t.tabEl = tabEl;
      strip.appendChild(tabEl);
      if (!t.el.isConnected) content.appendChild(t.el);
      t.el.style.display = i === activeIndex ? '' : 'none';
    });
  }

  function addTabFor(view: ViewId): void {
    const tag = opts.nextTag();
    const el = opts.buildInstance(view, tag);
    if (!el) return;
    tabs.push({ view, tag, el, tabEl: w.document.createElement('div') });
    activeIndex = tabs.length - 1;
    renderStrip();
  }

  function closeTab(i: number): void {
    if (tabs.length <= 1) { cleanup(); return; } // last tab closes the popup
    tabs[i].el.remove();
    tabs.splice(i, 1);
    if (activeIndex >= tabs.length) activeIndex = tabs.length - 1;
    renderStrip();
  }

  addBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    w.document.getElementById('rw-popout-addmenu')?.remove();
    const ul = w.document.createElement('ul');
    ul.id = 'rw-popout-addmenu';
    ul.className = 'rw-kf-menu';
    const r = addBtn.getBoundingClientRect();
    ul.style.left = `${r.left}px`;
    ul.style.top = `${r.bottom + 4}px`;
    for (const v of opts.listAvailableViews()) {
      const li = w.document.createElement('li');
      const here = tabs.some((t) => t.view === v);
      li.textContent = here ? `${opts.viewLabels[v]} (already here)` : opts.viewLabels[v];
      if (here) li.classList.add('disabled');
      else li.addEventListener('click', () => { ul.remove(); addTabFor(v); });
      ul.appendChild(li);
    }
    w.document.body.appendChild(ul);
    const close = (e: Event): void => {
      if (e.target instanceof Node && ul.contains(e.target)) return;
      ul.remove();
      w.document.removeEventListener('pointerdown', close, true);
    };
    setTimeout(() => w.document.addEventListener('pointerdown', close, true), 0);
  });

  tabs.push({ view: opts.view, tag: opts.tag, el: opts.el, tabEl: w.document.createElement('div') });
  renderStrip();

  const cleanup = (): void => {
    try { releaseDocument(w.document); } catch { /* closed */ }
    unsubTextScale();
    openPopups.delete(opts.view);
    if (!w.closed) w.close();
  };
  w.addEventListener('pagehide', cleanup);
  window.addEventListener('pagehide', cleanup);
  return true;
}
