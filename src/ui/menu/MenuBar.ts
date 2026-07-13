/**
 * Traditional app menu bar (File / Edit / View / Window / Help) along
 * the top of the viewport. Desktop-only chrome: hidden in the compact
 * layout (which keeps its TopStrip) and in viewer mode — the
 * `--rw-menubar-h` CSS var on <body> is what every offset consumer
 * (HUD, panel, timeline, availableCanvasRect) reads, and it drops to 0
 * whenever the bar is hidden.
 *
 * Items resolve lazily at open time: an entry can point at an
 * `AppAction` id (label / shortcut / enabled / checked all come from
 * the registry — src/ui/actions.ts) or carry a direct `run`. Submenus
 * (e.g. File → Open Recent) rebuild their entries on every open, so
 * dynamic lists never go stale.
 */

import './menubar.css';
import { getAction, runAction } from '../actions';

export type MenuEntry =
  | { sep: true }
  | {
      label?: string;          // defaults to the action's label
      actionId?: string;
      run?: () => void;
      enabled?: () => boolean;
      checked?: () => boolean; // renders a leading ✓ (checkbox/radio)
      shortcut?: string;
      submenu?: () => MenuEntry[];
    };

export interface MenuSpec {
  label: string;
  items: () => MenuEntry[];
}

export function createMenuBar(specs: MenuSpec[]): { el: HTMLElement } {
  const bar = document.createElement('div');
  bar.id = 'rw-menubar';
  bar.setAttribute('role', 'menubar');

  let openMenu: HTMLElement | null = null;
  let openButton: HTMLButtonElement | null = null;

  function closeAll(): void {
    openMenu?.remove();
    openMenu = null;
    openButton?.classList.remove('open');
    openButton = null;
  }

  function buildList(entries: MenuEntry[], x: number, y: number): HTMLElement {
    const ul = document.createElement('ul');
    ul.className = 'rw-menu';
    ul.setAttribute('role', 'menu');
    ul.style.left = `${x}px`;
    ul.style.top = `${y}px`;
    for (const e of entries) {
      if ('sep' in e) {
        const li = document.createElement('li');
        li.className = 'rw-menu-sep';
        li.setAttribute('role', 'separator');
        ul.appendChild(li);
        continue;
      }
      const a = e.actionId ? getAction(e.actionId) : undefined;
      const li = document.createElement('li');
      li.setAttribute('role', 'menuitem');
      const enabled = e.enabled ? e.enabled() : (a?.enabled ? a.enabled() : true);
      const checked = e.checked ? e.checked() : a?.checked?.();
      const label = e.label ?? a?.label ?? e.actionId ?? '';
      const shortcut = e.shortcut ?? a?.shortcut;

      const mark = document.createElement('span');
      mark.className = 'rw-menu-mark';
      mark.textContent = checked ? '✓' : '';
      const text = document.createElement('span');
      text.className = 'rw-menu-label';
      text.textContent = label;
      li.append(mark, text);
      if (shortcut) {
        const sc = document.createElement('span');
        sc.className = 'rw-menu-shortcut';
        sc.textContent = shortcut;
        li.appendChild(sc);
      }
      if (e.submenu) {
        const arrow = document.createElement('span');
        arrow.className = 'rw-menu-sub-arrow';
        arrow.textContent = '▸';
        li.appendChild(arrow);
      }

      if (!enabled) {
        li.classList.add('disabled');
        li.setAttribute('aria-disabled', 'true');
      } else if (e.submenu) {
        let sub: HTMLElement | null = null;
        li.addEventListener('pointerenter', () => {
          ul.querySelectorAll(':scope > li > .rw-menu').forEach((n) => n.remove());
          const r = li.getBoundingClientRect();
          sub = buildList(e.submenu!(), r.right - 2, r.top - 4);
          sub.classList.add('rw-menu-sub');
          li.appendChild(sub);
        });
        li.addEventListener('pointerleave', (ev) => {
          if (sub && ev.relatedTarget instanceof Node && sub.contains(ev.relatedTarget)) return;
          sub?.remove();
          sub = null;
        });
      } else {
        li.addEventListener('click', () => {
          closeAll();
          if (e.actionId) runAction(e.actionId);
          else e.run?.();
        });
      }
      ul.appendChild(li);
    }
    return ul;
  }

  function openFor(btn: HTMLButtonElement, spec: MenuSpec): void {
    closeAll();
    const r = btn.getBoundingClientRect();
    openMenu = buildList(spec.items(), r.left, r.bottom + 2);
    openButton = btn;
    btn.classList.add('open');
    document.body.appendChild(openMenu);
  }

  for (const spec of specs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rw-menubar-item';
    btn.textContent = spec.label;
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.addEventListener('click', () => {
      if (openButton === btn) closeAll();
      else openFor(btn, spec);
    });
    // Windows/mac convention: once a menu is open, sliding along the bar
    // switches menus without another click.
    btn.addEventListener('pointerenter', () => {
      if (openMenu && openButton !== btn) openFor(btn, spec);
    });
    bar.appendChild(btn);
  }

  document.addEventListener('pointerdown', (ev) => {
    if (!openMenu) return;
    const t = ev.target as Node;
    if (bar.contains(t) || openMenu.contains(t)) return;
    closeAll();
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openMenu) closeAll();
  });

  return { el: bar };
}
