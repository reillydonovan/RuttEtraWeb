/**
 * Themed dropdown menus for every native <select> in the app.
 *
 * A native <select>'s open list is drawn by the OS: its panel, hover and
 * selected states can't be styled (CSS reaches only the option colours), so it
 * always looked like the browser rather than the design system. This replaces
 * that popup — and only that popup — with a menu built from the same tokens as
 * every other floating surface: the <select> itself stays in the DOM as the
 * single source of truth (its `value`, `change` events, `data-param-key`,
 * disabled state, and every `select.value = …` the code or MIDI/OSC/MCP does),
 * so nothing that reads or writes it needs to know.
 *
 * One delegated listener per document (main window and every popout). Phones
 * keep the native picker (it is the right control there; compact layout also
 * has its own bottom-sheet picker), and a select can opt out with
 * `data-native-select`.
 *
 * Keyboard: ↑/↓ move, Home/End jump, Enter/Space choose, Esc closes, typing a
 * letter jumps to the next matching label — and Space/Enter/↓ on a focused
 * select opens the menu like the native one.
 */

import './dropdown.css';
import { layoutManager } from './layout/LayoutManager';
import { MenuRow, nextOption, firstOption, lastOption, typeahead, placeMenu } from './dropdownModel';

const installed = new WeakSet<Document>();

interface Open {
  select: HTMLSelectElement;
  menu: HTMLElement;
  rows: MenuRow[];
  els: HTMLElement[];
  values: string[];
  active: number;
  typed: string;
  typedAt: number;
  close: (focusSelect?: boolean) => void;
}
let open: Open | null = null;

/** Install the themed menu on `doc` (idempotent). Returns an uninstall function. */
export function installSelectMenus(doc: Document): () => void {
  if (installed.has(doc)) return () => { /* already installed by an earlier call */ };
  installed.add(doc);

  const eligible = (t: EventTarget | null): HTMLSelectElement | null => {
    const el = t instanceof (doc.defaultView?.Element ?? Element) ? (t as Element).closest('select') : null;
    if (!el || el.multiple || el.size > 1 || el.disabled || el.hasAttribute('data-native-select')) return null;
    if (layoutManager().current() === 'compact' && layoutManager().hasTouch) return null;   // phones: the OS picker
    return el;
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const sel = eligible(e.target);
    if (!sel) return;
    e.preventDefault();               // suppresses the native popup
    sel.focus({ preventScroll: true });
    if (open?.select === sel) { open.close(); return; }
    openMenu(doc, sel);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (open) return;                  // the open menu handles its own keys
    const sel = eligible(e.target);
    if (!sel || e.target !== sel) return;
    if (e.key === ' ' || e.key === 'Enter' || (e.key === 'ArrowDown' && e.altKey)) {
      e.preventDefault();
      openMenu(doc, sel);
    }
  };
  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    installed.delete(doc);
  };
}

function buildRows(sel: HTMLSelectElement): { rows: MenuRow[]; values: string[]; selectedIndex: number; build: (doc: Document) => HTMLElement[] } {
  const rows: MenuRow[] = [];
  const values: string[] = [];
  const nodes: Array<{ kind: 'group' | 'option'; label: string; disabled: boolean; selected: boolean; nested: boolean }> = [];
  let selectedIndex = -1;
  const pushOption = (o: HTMLOptionElement, nested: boolean): void => {
    rows.push({ kind: 'option', label: o.textContent ?? '', disabled: o.disabled });
    values.push(o.value);
    if (o.selected && selectedIndex < 0) selectedIndex = rows.length - 1;
    nodes.push({ kind: 'option', label: o.textContent ?? '', disabled: o.disabled, selected: o.selected, nested });
  };
  for (const child of Array.from(sel.children)) {
    if (child instanceof HTMLOptGroupElement) {
      rows.push({ kind: 'group', label: child.label });
      values.push('');
      nodes.push({ kind: 'group', label: child.label, disabled: true, selected: false, nested: false });
      for (const o of Array.from(child.children)) if (o instanceof HTMLOptionElement) pushOption(o, true);
    } else if (child instanceof HTMLOptionElement) {
      pushOption(child, false);
    }
  }
  const build = (doc: Document): HTMLElement[] => nodes.map((n, i) => {
    const el = doc.createElement('div');
    if (n.kind === 'group') {
      el.className = 'rw-dd-group';
      el.textContent = n.label;
      el.setAttribute('role', 'presentation');
    } else {
      el.className = 'rw-dd-opt' + (n.selected ? ' selected' : '') + (n.disabled ? ' disabled' : '') + (n.nested ? ' nested' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(n.selected));
      if (n.disabled) el.setAttribute('aria-disabled', 'true');
      const t = doc.createElement('span');
      t.className = 'rw-dd-label';
      t.textContent = n.label;
      el.appendChild(t);
    }
    el.dataset.i = String(i);
    return el;
  });
  return { rows, values, selectedIndex, build };
}

function openMenu(doc: Document, sel: HTMLSelectElement): void {
  open?.close();
  const win = doc.defaultView ?? window;
  const { rows, values, selectedIndex, build } = buildRows(sel);
  if (!rows.length) return;

  const menu = doc.createElement('div');
  menu.className = 'rw-dd-menu';
  menu.setAttribute('role', 'listbox');
  menu.tabIndex = -1;
  const els = build(doc);
  menu.append(...els);
  doc.body.appendChild(menu);

  const a = sel.getBoundingClientRect();
  const p = placeMenu(
    { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
    { width: win.innerWidth, height: win.innerHeight },
    380, 0,
  );
  menu.style.left = `${p.left}px`;
  menu.style.minWidth = `${p.width}px`;
  menu.style.maxHeight = `${p.maxHeight}px`;
  // Natural width may exceed the field's (long labels): keep it on screen.
  const w = Math.min(menu.offsetWidth, win.innerWidth - 16);
  menu.style.left = `${Math.max(8, Math.min(p.left, win.innerWidth - 8 - w))}px`;
  menu.style.top = p.above ? `${a.top - 4 - menu.offsetHeight}px` : `${p.top}px`;
  menu.classList.toggle('above', p.above);

  const state: Open = {
    select: sel, menu, rows, els, values,
    active: selectedIndex >= 0 ? selectedIndex : firstOption(rows),
    typed: '', typedAt: 0,
    close: () => { /* set below */ },
  };
  const setActive = (i: number, scroll = true): void => {
    if (i < 0 || i >= els.length) return;
    els[state.active]?.classList.remove('active');
    state.active = i;
    els[i].classList.add('active');
    if (scroll) els[i].scrollIntoView({ block: 'nearest' });
  };
  const choose = (i: number): void => {
    const r = rows[i];
    if (!r || r.kind !== 'option' || r.disabled) return;
    state.close(true);
    if (sel.value !== values[i]) {
      sel.value = values[i];
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); state.close(true); return; }
    if (k === 'Tab') { state.close(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(nextOption(rows, state.active, 1)); return; }
    if (k === 'ArrowUp') { e.preventDefault(); setActive(nextOption(rows, state.active, -1)); return; }
    if (k === 'Home') { e.preventDefault(); setActive(firstOption(rows)); return; }
    if (k === 'End') { e.preventDefault(); setActive(lastOption(rows)); return; }
    const typing = state.typed !== '' && performance.now() - state.typedAt <= 700;   // mid-word: a space is a letter ("Z Push")
    if (k === 'Enter' || (k === ' ' && !typing)) { e.preventDefault(); choose(state.active); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const now = performance.now();
      state.typed = now - state.typedAt > 700 ? k : state.typed + k;
      state.typedAt = now;
      setActive(typeahead(rows, state.active, state.typed));
    }
  };
  const onOutside = (e: MouseEvent): void => {
    if (!(e.target instanceof win.Node) || !menu.contains(e.target)) {
      // A press on the same select toggles it shut via the main listener.
      state.close();
    }
  };
  const onResize = (): void => state.close();
  const onWheel = (e: Event): void => { if (!(e.target instanceof win.Node) || !menu.contains(e.target)) state.close(); };

  menu.addEventListener('mousemove', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.rw-dd-opt');
    if (t && !t.classList.contains('disabled')) {
      const i = Number(t.dataset.i);
      if (i !== state.active) setActive(i, false);
    }
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault());   // keep focus on the select
  menu.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.rw-dd-opt');
    if (t) choose(Number(t.dataset.i));
  });

  state.close = (focusSelect = false): void => {
    if (open !== state) return;
    open = null;
    doc.removeEventListener('mousedown', onOutside, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('wheel', onWheel, true);
    win.removeEventListener('resize', onResize);
    menu.remove();
    sel.setAttribute('aria-expanded', 'false');
    if (focusSelect) sel.focus({ preventScroll: true });
  };
  open = state;
  sel.setAttribute('aria-expanded', 'true');
  // Registered next tick so the press that opened the menu isn't its own outside-click.
  win.setTimeout(() => {
    if (open !== state) return;
    doc.addEventListener('mousedown', onOutside, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
    win.addEventListener('resize', onResize);
  }, 0);

  if (state.active >= 0) { els[state.active].classList.add('active'); els[state.active].scrollIntoView({ block: 'nearest' }); }
}
