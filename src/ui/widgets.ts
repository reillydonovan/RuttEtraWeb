/**
 * Tiny set of reusable form widgets that bind to a key in the SettingsStore.
 * Every widget returns the row element so sections can append it directly.
 *
 * Touch upgrades (gated on `LayoutManager.hasTouch` at runtime):
 *   - slider:   double-tap → reset, long-press → numeric modal,
 *               vertical-distance scrub for fine adjustment
 *   - dropdown: replaces native open with `BottomSheetPicker` in compact mode
 *   - keyboard equivalents preserved (range arrow keys; Backspace on focus
 *     resets to default)
 */

import { Settings, SettingsStore, DEFAULTS } from '../state/Settings';
import { layoutManager } from './layout/LayoutManager';
import { presentSheetPicker } from './widgets/BottomSheetPicker';

export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rw-row';
  const l = document.createElement('label');
  l.textContent = label;
  l.className = 'rw-label';
  r.appendChild(l);
  control.classList.add('rw-control');
  r.appendChild(control);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'rw-hint';
    h.textContent = hint;
    r.appendChild(h);
  }
  return r;
}

export function group(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'rw-group';
  const head = document.createElement('div');
  head.className = 'rw-group-head';
  head.textContent = title;
  const body = document.createElement('div');
  body.className = 'rw-group-body';
  root.append(head, body);
  return { root, body };
}

type NumberKeys = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

type BooleanKeys = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type StringKeys = {
  [K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];

export function slider(
  settings: SettingsStore,
  key: NumberKeys,
  min: number,
  max: number,
  step = 0.01,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-slider';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(min);
  num.max = String(max);
  num.step = String(step);
  num.className = 'rw-num';
  wrap.append(range, num);

  const defaultValue = (DEFAULTS as unknown as Record<string, unknown>)[key as string] as number;

  // Compact-mode stop-chips + tappable readout. Always built and inserted
  // into the DOM; CSS hides them outside compact and hides the native
  // range / number input inside compact. This way a layout flip
  // (`?layout=` override or window resize) is purely a CSS swap with no
  // JS rebuild required.
  const stops = computeStops(min, max, step, 5);
  const stopBar = document.createElement('div');
  stopBar.className = 'rw-slider-stops';
  const chips: HTMLButtonElement[] = stops.map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rw-slider-stop';
    b.textContent = formatNum(v, step);
    b.addEventListener('click', () => settings.set(key, v as never));
    return b;
  });
  stopBar.append(...chips);

  const readoutBtn = document.createElement('button');
  readoutBtn.type = 'button';
  readoutBtn.className = 'rw-slider-readout';
  readoutBtn.addEventListener('click', () => {
    openNumericModal(`Enter ${String(key)}`, settings.get(key) as number, min, max, step, (v) => {
      settings.set(key, v as never);
    });
  });
  wrap.append(stopBar, readoutBtn);

  const apply = (v: number) => {
    range.value = String(v);
    num.value = formatNum(v, step);
    readoutBtn.textContent = formatNum(v, step);
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const d = Math.abs(stops[i] - v);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    chips.forEach((c, i) => c.classList.toggle('selected', i === best));
  };
  settings.subscribe(key, (v) => apply(v as number));

  range.addEventListener('input', () => settings.set(key, +range.value as never));
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) settings.set(key, v as never);
  });

  // ----- Touch upgrades -----
  // Double-click / double-tap → reset to default. Keyboard equivalent:
  // Backspace/Delete on a focused range. Native horizontal drag continues
  // to fire `input` events untouched.
  range.addEventListener('dblclick', () => settings.set(key, defaultValue as never));
  range.addEventListener('keydown', (ev) => {
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      settings.set(key, defaultValue as never);
    }
  });

  // Detect double-tap reset on touch — separate from any other touch handler
  // and never preventDefault, so native slider drag still works.
  if (layoutManager().hasTouch) {
    let lastTapAt = 0;
    let lastTapX = 0, lastTapY = 0;
    range.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      const now = performance.now();
      const dx = ev.clientX - lastTapX;
      const dy = ev.clientY - lastTapY;
      if (now - lastTapAt < 320 && Math.hypot(dx, dy) < 20) {
        settings.set(key, defaultValue as never);
        lastTapAt = 0;
      } else {
        lastTapAt = now;
        lastTapX = ev.clientX;
        lastTapY = ev.clientY;
      }
    });

    // Long-press → numeric input modal. Cancelled if the finger moves
    // more than a few px (i.e. the user is dragging the slider, not
    // requesting precise entry).
    let pressTimer: number | null = null;
    let pressStartX = 0, pressStartY = 0;
    const cancelLongPress = () => {
      if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; }
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 6) cancelLongPress();
    };
    range.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      cancelLongPress();
      pressStartX = ev.clientX; pressStartY = ev.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        openNumericModal(`Enter ${String(key)}`, settings.get(key) as number, min, max, step, (v) => {
          settings.set(key, v as never);
        });
      }, 700);
      range.addEventListener('pointermove', onMove);
      const stop = () => {
        cancelLongPress();
        range.removeEventListener('pointermove', onMove);
      };
      range.addEventListener('pointerup',     stop, { once: true });
      range.addEventListener('pointercancel', stop, { once: true });
      range.addEventListener('pointerleave',  stop, { once: true });
    });
  }

  return wrap;
}

function clampNumber(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function openNumericModal(
  title: string, current: number, min: number, max: number, step: number,
  onAccept: (v: number) => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'rw-numeric-modal';
  const card = document.createElement('div');
  card.className = 'rw-numeric-modal-card';
  const t = document.createElement('div');
  t.className = 'rw-numeric-modal-title';
  t.textContent = title;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(current);
  inp.inputMode = 'decimal';
  const row = document.createElement('div');
  row.className = 'rw-numeric-modal-row';
  const cancel = document.createElement('button');
  cancel.className = 'rw-btn'; cancel.type = 'button'; cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.className = 'rw-btn primary'; ok.type = 'button'; ok.textContent = 'OK';
  row.append(cancel, ok);
  card.append(t, inp, row);
  overlay.append(card);
  document.body.appendChild(overlay);
  inp.focus(); inp.select();
  const close = () => overlay.remove();
  cancel.addEventListener('click', close);
  ok.addEventListener('click', () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) onAccept(clampNumber(v, min, max));
    close();
  });
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ok.click();
    if (ev.key === 'Escape') cancel.click();
  });
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cancel.click(); });
}

export function toggle(settings: SettingsStore, key: BooleanKeys, label = ''): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'rw-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  const sw = document.createElement('span');
  sw.className = 'rw-toggle-sw';
  const txt = document.createElement('span');
  txt.className = 'rw-toggle-txt';
  txt.textContent = label;
  wrap.append(cb, sw, txt);

  settings.subscribe(key, (v) => { cb.checked = !!v; });
  cb.addEventListener('change', () => settings.set(key, cb.checked as any));
  return wrap;
}

export function dropdown<K extends keyof Settings>(
  settings: SettingsStore,
  key: K,
  options: { value: Settings[K]; label: string }[],
): HTMLElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  settings.subscribe(key, (v) => { sel.value = String(v); });
  sel.addEventListener('change', () => {
    const raw = sel.value;
    const found = options.find((o) => String(o.value) === raw);
    if (found) settings.set(key, found.value);
  });

  // Compact + touch: intercept the native open and use a bottom-sheet picker.
  const intercept = (ev: Event) => {
    const layout = layoutManager();
    if (layout.current() !== 'compact' || !layout.hasTouch) return;
    ev.preventDefault();
    presentSheetPicker({
      title: String(key),
      options: options.map((o) => ({ value: String(o.value), label: o.label })),
      selected: String(settings.get(key)),
      onPick: (v) => {
        const found = options.find((o) => String(o.value) === v);
        if (found) settings.set(key, found.value);
      },
    });
  };
  sel.addEventListener('mousedown',   intercept);
  sel.addEventListener('touchstart',  intercept, { passive: false });

  return sel;
}

export function colorInput(settings: SettingsStore, key: StringKeys): HTMLElement {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.className = 'rw-color';
  settings.subscribe(key, (v) => { inp.value = v as string; });
  inp.addEventListener('input', () => settings.set(key, inp.value as any));
  return inp;
}

export function button(label: string, onClick: () => void, variant = ''): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `rw-btn ${variant}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function textInput(value: string, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.placeholder = placeholder;
  i.className = 'rw-text';
  return i;
}

export function readout(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'rw-readout';
  return d;
}

function formatNum(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  if (step >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Generates `n` evenly-spaced "stop" values between `min` and `max`,
 * snapped to the slider's step grid. Used to drive the compact-mode
 * stop-chip strip in place of the native range slider.
 */
function computeStops(min: number, max: number, step: number, n: number): number[] {
  const out: number[] = [];
  const stepDecimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const raw = min + (max - min) * t;
    const snapped = Math.round((raw - min) / step) * step + min;
    out.push(parseFloat(snapped.toFixed(stepDecimals + 3)));
  }
  return out;
}
