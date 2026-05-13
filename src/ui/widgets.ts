/**
 * Tiny set of reusable form widgets that bind to a key in the SettingsStore.
 * Every widget returns the row element so sections can append it directly.
 */

import { Settings, SettingsStore } from '../state/Settings';

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

  const apply = (v: number) => {
    range.value = String(v);
    num.value = formatNum(v, step);
  };
  settings.subscribe(key, (v) => apply(v as number));

  range.addEventListener('input', () => settings.set(key, +range.value as any));
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) settings.set(key, v as any);
  });

  return wrap;
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
