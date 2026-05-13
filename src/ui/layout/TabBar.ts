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
      ico.textContent = t.icon;

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
