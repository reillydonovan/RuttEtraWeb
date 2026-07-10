/**
 * Shared context menu for the timeline dock (scene track + lane editor).
 * Extracted from TimelineTrack so lane rows don't grow a third copy.
 * One menu at a time; any outside click dismisses.
 */

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

document.addEventListener('click', (ev) => {
  if (openMenu && !openMenu.contains(ev.target as Node)) dismiss();
});

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  dismiss();
  const ul = document.createElement('ul');
  ul.className = 'rw-tl-ctx';
  ul.style.left = `${x}px`;
  ul.style.top = `${y}px`;
  for (const item of items) {
    const li = document.createElement('li');
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
  document.body.appendChild(ul);
  // Clamp inside the viewport — a menu opened near the right/bottom edge
  // (e.g. on the inspector column) must stay fully usable.
  const r = ul.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (x + r.width > vw - 4) ul.style.left = `${Math.max(4, vw - r.width - 4)}px`;
  if (y + r.height > vh - 4) ul.style.top = `${Math.max(4, vh - r.height - 4)}px`;
  openMenu = ul;
}

export function dismissContextMenu(): void {
  dismiss();
}
