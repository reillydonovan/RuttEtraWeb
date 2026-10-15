/**
 * Bottom tab bar shown only in compact mode.
 *
 * Tapping a tab calls `onSelect(tabId)`; the host (ResponsivePanel) opens
 * the matching bottom sheet. Tabs always remain visible — they're how the
 * user navigates the app on phones.
 */

import { CompactTabSpec } from './LayoutGroups';

export type TabBarTabId = CompactTabSpec['id'];

export class TabBar {
  el: HTMLElement;
  private buttons = new Map<TabBarTabId, HTMLButtonElement>();
  private activeId: TabBarTabId | null = null;

  constructor(tabs: CompactTabSpec[], onSelect: (id: TabBarTabId) => void) {
    this.el = document.createElement('nav');
    this.el.id = 'tab-bar';
    this.el.setAttribute('role', 'tablist');
    this.el.setAttribute('aria-label', 'Sections');

    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-tabbar-btn';
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `sheet-${t.id}`);
      b.setAttribute('aria-selected', 'false');

      const ico = document.createElement('span');
      ico.className = 'rw-tabbar-ico';
      if (ICONS[t.icon]) ico.innerHTML = ICONS[t.icon]; else ico.textContent = t.icon;

      const lbl = document.createElement('span');
      lbl.className = 'rw-tabbar-lbl';
      lbl.textContent = t.label;

      b.append(ico, lbl);
      b.addEventListener('click', () => onSelect(t.id));
      this.buttons.set(t.id, b);
      this.el.appendChild(b);
    }
  }

  setActive(id: TabBarTabId | null): void {
    this.activeId = id;
    for (const [tabId, btn] of this.buttons) {
      const on = tabId === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    }
  }

  current(): TabBarTabId | null { return this.activeId; }
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** Tab glyphs — thin strokes in the Modern system's own line weight. */
const ICONS: Record<string, string> = {
  source: svg('<rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8 6l1.2-2h5.6L16 6"/>'),
  shape:  svg('<path d="M3 17c2.5-6 5-9 9-9s6.5 3 9 9"/><path d="M3 20h18"/><path d="M7 14.5l1.5-2M12 12.5v-3M17 14.5l-1.5-2"/>'),
  motion: svg('<path d="M2 12c2-5 3.5-5 5 0s3 5 5 0 3.5-5 5 0 2.5 3 3 2"/>'),
  color:  svg('<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>'),
  more:   svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
};
