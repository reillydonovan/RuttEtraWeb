/**
 * Shared context menu: the timeline dock (scene track + lane editor) and the
 * Advanced graph editor's nodes. One menu at a time; an outside click or Esc
 * dismisses. Pass `doc` when the caller may live in a popped-out window.
 */

import './contextMenu.css';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

let openMenu: HTMLElement | null = null;

function dismiss(): void {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

const wired = new WeakSet<Document>();
function wire(doc: Document): void {
  if (wired.has(doc)) return;
  wired.add(doc);
  doc.addEventListener('click', (ev) => {
    if (openMenu && !openMenu.contains(ev.target as Node)) dismiss();
  });
  doc.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openMenu) dismiss();
  });
}
wire(document);

export function showContextMenu(x: number, y: number, items: ContextMenuItem[], doc: Document = document): void {
  dismiss();
  wire(doc);
  const ul = doc.createElement('ul');
  ul.className = 'rw-tl-ctx';
  ul.style.left = `${x}px`;
  ul.style.top = `${y}px`;
  for (const item of items) {
    const li = doc.createElement('li');
    if (item.separator) {
      li.className = 'sep';
    } else {
      li.textContent = item.label;
      if (item.disabled) li.classList.add('disabled');
      else li.addEventListener('click', () => {
        item.onClick?.();
        dismiss();
      });
    }
    ul.appendChild(li);
  }
  doc.body.appendChild(ul);
  // Clamp inside the viewport — a menu opened near the right/bottom edge
  // (e.g. on the inspector column) must stay fully usable.
  const r = ul.getBoundingClientRect();
  const win = doc.defaultView ?? window;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  if (x + r.width > vw - 4) ul.style.left = `${Math.max(4, vw - r.width - 4)}px`;
  if (y + r.height > vh - 4) ul.style.top = `${Math.max(4, vh - r.height - 4)}px`;
  openMenu = ul;
}

export function dismissContextMenu(): void {
  dismiss();
}
