/**
 * Panel-wide parameter search (AUDIT item 26 — modest win #1).
 *
 * A single text box above the tab strip. Typing filters the whole panel
 * across ALL tabs, entirely DOM-driven — no per-section registration:
 *
 *   - Sections with matching rows (label / hint / section title) expand;
 *     everything else collapses.
 *   - Matching rows highlight; non-matching rows in a matched section dim.
 *   - If the active tab has no match but another does, the panel switches
 *     to the first matching tab.
 *   - Clearing the query restores each section's pre-search open state.
 *
 * `/` focuses the box from anywhere (wired in main.ts); Escape clears
 * and blurs. Purely additive — no section markup changes.
 */

import { SettingsStore } from '../state/Settings';
import type { TabId } from './ControlPanel';

const TAB_ORDER: TabId[] = ['synth', 'io', 'help'];

export function createPanelSearch(
  panelRoot: HTMLElement,
  settings: SettingsStore,
): { el: HTMLElement; focus(): void } {
  const wrap = document.createElement('div');
  wrap.className = 'rw-panel-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search params…  ( / )';
  input.setAttribute('aria-label', 'Search parameters');
  wrap.appendChild(input);

  /** Pre-search collapsed state, captured on first keystroke of a query. */
  let saved: Map<HTMLElement, boolean> | null = null;

  function sections(): HTMLElement[] {
    return Array.from(panelRoot.querySelectorAll<HTMLElement>('.rw-section'));
  }

  function clearFilter(): void {
    for (const sec of sections()) {
      if (saved) sec.classList.toggle('collapsed', saved.get(sec) ?? true);
      for (const r of Array.from(sec.querySelectorAll('.rw-row'))) {
        r.classList.remove('rw-row--hit', 'rw-row--dim');
      }
    }
    saved = null;
  }

  function applyFilter(qRaw: string): void {
    const q = qRaw.trim().toLowerCase();
    if (!q) { clearFilter(); return; }
    if (!saved) {
      saved = new Map(sections().map((s) => [s, s.classList.contains('collapsed')]));
    }
    const tabHasMatch = new Map<TabId, boolean>();
    for (const sec of sections()) {
      const titleEl = sec.querySelector('.rw-section-head span');
      const title = (titleEl?.textContent ?? '').toLowerCase();
      const titleMatches = title.includes(q);
      let sectionHasHit = titleMatches;
      const rows = Array.from(sec.querySelectorAll<HTMLElement>('.rw-row'));
      for (const r of rows) {
        const label = r.querySelector('.rw-label')?.textContent ?? '';
        const hint = r.querySelector('.rw-hint')?.textContent ?? '';
        const hit = `${label} ${hint}`.toLowerCase().includes(q);
        r.classList.toggle('rw-row--hit', hit);
        sectionHasHit = sectionHasHit || hit;
      }
      for (const r of rows) {
        r.classList.toggle(
          'rw-row--dim',
          sectionHasHit && !titleMatches && !r.classList.contains('rw-row--hit'),
        );
      }
      sec.classList.toggle('collapsed', !sectionHasHit);
      if (sectionHasHit) {
        const pane = sec.closest<HTMLElement>('.rw-tab-pane');
        const idx = pane ? Array.from(pane.parentElement?.querySelectorAll('.rw-tab-pane') ?? []).indexOf(pane) : -1;
        if (idx >= 0 && idx < TAB_ORDER.length) tabHasMatch.set(TAB_ORDER[idx], true);
      }
    }
    // Jump to the first tab that has matches if the active one has none.
    const active = settings.get('panelTab') as TabId;
    if (!tabHasMatch.get(active)) {
      const first = TAB_ORDER.find((t) => tabHasMatch.get(t));
      if (first) settings.set('panelTab', first);
    }
  }

  input.addEventListener('input', () => applyFilter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      clearFilter();
      input.blur();
      e.stopPropagation();
    }
  });
  // <input type=search> clear button fires 'search' in some engines.
  input.addEventListener('search', () => applyFilter(input.value));

  return {
    el: wrap,
    focus(): void {
      input.focus();
      input.select();
    },
  };
}

/** True when a key event originates from a typing context. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
