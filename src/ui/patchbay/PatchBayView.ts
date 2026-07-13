/**
 * PATCH BAY — a dedicated spatial view styled as the front panel of the
 * original console ("inspired, not replica"): engraved module fields,
 * every jack always visible at a fixed position, gravity-sagged cables.
 * Hosts in any workspace region (Phase 2's view registry).
 *
 * Layout (patchbayLayout.ts, pure/tested):
 *   left rail    4 × FUNCTION GENERATOR modules (the Classic slots) +
 *                the SOURCES signal field + CV OUT + GRAPH ENGINE chip
 *   column 1     DCU fields, the manual's brochure sub-groups
 *   column 2     Colorizer/Post-FX, Camera, Pattern, Geometry, Audio
 *
 * Interactions (all writes are ordinary patch-data writes):
 *   slot OUT  → param jack   sets modSlots[i].target  (applyCableTarget)
 *   param jack (plugged)     grab to move; drop in space to unplug
 *   param jack (empty)       reverse-drag to a slot OUT
 *   SOURCES jack → SRC IN    sets modSlots[i].source  (applyCableSource)
 *   graph binding cables     read-only (the graph editor edits those)
 *
 * Unlike the rack skin's overlay there is NO DOM scanning and NO anchor
 * fallback chain — the bay owns its layout, so the jack registry is
 * static and every anchor is a live rect of a known element.
 */

import './patchbay.css';
import type { SettingsStore, ModSlot, ModTarget, ModSource } from '../../state/Settings';
import { drawPatchCable } from '../cableDraw';
import { attachTooltip } from '../tooltip';
import {
  classicCables, graphCables, applyCableTarget, applyCableSource,
  slotForParam, nearestJack, rectCenter, Pt,
} from '../rack/rackGeometry';
import { buildFaceplate, SOURCE_JACKS } from './patchbayLayout';
import { cvOutputTargets } from '../targets';

const CLASSIC_COLOR = '#5fff85';
const SOURCE_COLOR  = '#b9ffd0';
const GRAPH_COLOR   = '#5fffd0';
const SNAP_PX = 26;

type JackId =
  | { kind: 'param'; key: string }
  | { kind: 'slotout'; index: number }
  | { kind: 'slotsrc'; index: number }
  | { kind: 'src'; source: ModSource };

export function createPatchBayView(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-patchbay';

  const surface = document.createElement('div');
  surface.className = 'rw-pb-surface';
  root.appendChild(surface);

  let canvas = document.createElement('canvas');
  canvas.className = 'rw-pb-cables';
  surface.appendChild(canvas);
  let ctx = canvas.getContext('2d');

  // ---------------- jack registry (static — the whole point) ---------
  const paramJacks = new Map<string, HTMLElement>();
  const slotOutJacks = new Map<number, HTMLElement>();
  const slotSrcJacks = new Map<number, HTMLElement>();
  const srcJacks = new Map<ModSource, HTMLElement>();

  function makeJack(cls: string): HTMLElement {
    const j = document.createElement('span');
    j.className = `rw-rack-jack rw-pb-jack ${cls}`;
    return j;
  }

  // ---------------- drag machinery -----------------------------------
  type Pending =
    | { kind: 'to-param'; slotIndex: number; pos: Pt; hover: string | null }
    | { kind: 'to-slotout'; paramKey: string; pos: Pt; hover: number | null }
    | { kind: 'to-slotsrc'; source: ModSource; pos: Pt; hover: number | null };
  let pending: Pending | null = null;

  function centersOf<K>(m: Map<K, HTMLElement>): Array<Pt & { id: K }> {
    const out: Array<Pt & { id: K }> = [];
    for (const [id, el] of m) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push({ id, ...rectCenter(r) });
    }
    return out;
  }

  function runGesture(
    ev: PointerEvent,
    grabbed: HTMLElement,
    onMove: (pos: Pt) => void,
    onDrop: () => void,
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const doc = root.ownerDocument;
    const id = ev.pointerId;
    grabbed.classList.add('rw-rack-jack--grab');
    root.classList.add('rw-rack-dragging');
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      onMove({ x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', up);
      grabbed.classList.remove('rw-rack-jack--grab');
      root.classList.remove('rw-rack-dragging');
      onDrop();
    };
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
  }

  function setHover<K>(m: Map<K, HTMLElement>, prev: K | null, next: K | null): void {
    if (prev !== null && prev !== undefined) m.get(prev)?.classList.remove('rw-rack-jack--hover');
    if (next !== null && next !== undefined) m.get(next)?.classList.add('rw-rack-jack--hover');
  }

  function dragSlotOut(ev: PointerEvent, slotIndex: number, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-param', slotIndex, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(paramJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(paramJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(paramJacks, p.hover, null);
        pending = null;
        const slots = settings.get('modSlots');
        const next = p.hover ?? 'none';
        if (slots[slotIndex] && slots[slotIndex].target !== next) {
          settings.set('modSlots', applyCableTarget(slots, slotIndex, next as ModTarget | 'none'));
        }
      });
  }

  function dragParam(ev: PointerEvent, key: string, jack: HTMLElement): void {
    const i = slotForParam(settings.get('modSlots'), key);
    if (i >= 0) { dragSlotOut(ev, i, jack); return; }
    const p: Pending = { kind: 'to-slotout', paramKey: key, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(slotOutJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(slotOutJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(slotOutJacks, p.hover, null);
        pending = null;
        if (p.hover == null) return;
        const slots = settings.get('modSlots');
        if (slots[p.hover] && slots[p.hover].target !== key) {
          settings.set('modSlots', applyCableTarget(slots, p.hover, key as ModTarget));
        }
      });
  }

  function dragSource(ev: PointerEvent, source: ModSource, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-slotsrc', source, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(slotSrcJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(slotSrcJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(slotSrcJacks, p.hover, null);
        pending = null;
        if (p.hover == null) return;
        const slots = settings.get('modSlots');
        if (slots[p.hover] && slots[p.hover].source !== source) {
          settings.set('modSlots', applyCableSource(slots, p.hover, source));
        }
      });
  }

  // ---------------- left rail: function generators --------------------
  const rail = document.createElement('div');
  rail.className = 'rw-pb-rail';

  const writeSlot = (index: number, patch: Partial<ModSlot>): void => {
    const slots = settings.get('modSlots').slice();
    if (!slots[index]) return;
    slots[index] = { ...slots[index], ...patch };
    settings.set('modSlots', slots);
  };

  interface SlotRefs { en: HTMLInputElement; rate: HTMLInputElement; amount: HTMLInputElement; srcLcd: HTMLElement }
  const slotRefs: SlotRefs[] = [];

  for (let i = 0; i < settings.get('modSlots').length; i++) {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';

    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.className = 'rw-pb-led-toggle';
    en.addEventListener('change', () => writeSlot(i, { enabled: en.checked }));
    attachTooltip(en, 'Enable this function generator (plugging a cable also enables it).');
    const title = document.createElement('span');
    title.textContent = `FUNCTION GEN ${i + 1}`;
    head.append(en, title);

    const srcRow = document.createElement('div');
    srcRow.className = 'rw-pb-row';
    const srcIn = makeJack('rw-pb-jack--srcin');
    srcIn.addEventListener('pointerdown', (ev) => {
      // Re-drag the current source if it's one of the jackable signals.
      const s = settings.get('modSlots')[i]?.source;
      const jackable = SOURCE_JACKS.find((j) => j.source === s);
      if (jackable) dragSource(ev, jackable.source, srcIn);
    });
    attachTooltip(srcIn, 'SRC IN — drag a signal from the SOURCES field here to set this generator’s source.');
    const srcLcd = document.createElement('span');
    srcLcd.className = 'rw-pb-lcd';
    srcRow.append(srcIn, srcLcd);

    const mkNum = (label: string, step: string, tooltip: string, onInput: (v: number) => void): HTMLInputElement => {
      const row = document.createElement('div');
      row.className = 'rw-pb-row';
      const l = document.createElement('label');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = step;
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) onInput(v);
      });
      attachTooltip(row, tooltip);
      row.append(l, inp);
      mod.appendChild(row);
      return inp;
    };

    mod.append(head, srcRow);
    const rate = mkNum('RATE', '0.01', 'LFO frequency in Hz (Free sync).', (v) => writeSlot(i, { frequency: v }));
    const amount = mkNum('AMT', '0.01', 'Modulation amount (depth).', (v) => writeSlot(i, { amount: v }));

    const outRow = document.createElement('div');
    outRow.className = 'rw-pb-row rw-pb-row--out';
    const outLabel = document.createElement('label');
    outLabel.textContent = 'OUT';
    const out = makeJack('rw-rack-jack--out');
    out.addEventListener('pointerdown', (ev) => dragSlotOut(ev, i, out));
    attachTooltip(out, 'Output — drag to any param jack to patch it; drop in space to unplug.');
    outRow.append(outLabel, out);
    mod.appendChild(outRow);

    slotOutJacks.set(i, out);
    slotSrcJacks.set(i, srcIn);
    slotRefs.push({ en, rate, amount, srcLcd });
    rail.appendChild(mod);
  }

  // SOURCES field.
  {
    const field = document.createElement('div');
    field.className = 'rw-pb-field';
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = 'SOURCES';
    field.appendChild(t);
    const grid = document.createElement('div');
    grid.className = 'rw-pb-grid';
    for (const s of SOURCE_JACKS) {
      const cell = document.createElement('div');
      cell.className = 'rw-pb-cell';
      const jack = makeJack('rw-pb-jack--src');
      jack.addEventListener('pointerdown', (ev) => dragSource(ev, s.source, jack));
      attachTooltip(jack, `${s.label} — drag to a generator’s SRC IN.`);
      const l = document.createElement('span');
      l.textContent = s.label;
      cell.append(jack, l);
      grid.appendChild(cell);
      srcJacks.set(s.source, jack);
    }
    field.appendChild(grid);
    rail.appendChild(field);
  }

  // GRAPH ENGINE chip — the read-only source end of graph-binding cables.
  const graphChip = document.createElement('div');
  graphChip.className = 'rw-pb-field rw-pb-graph-chip';
  graphChip.textContent = 'GRAPH ENGINE';
  attachTooltip(graphChip, 'Graph-engine bindings render as cyan cables (read-only here — edit them in the graph editor).');
  rail.appendChild(graphChip);

  // ---------------- faceplate columns ---------------------------------
  const col1 = document.createElement('div');
  col1.className = 'rw-pb-col';
  const col2 = document.createElement('div');
  col2.className = 'rw-pb-col';

  function addParamCell(grid: HTMLElement, key: string, label: string): void {
    const cell = document.createElement('div');
    cell.className = 'rw-pb-cell';
    const jack = makeJack('rw-rack-jack--in');
    jack.addEventListener('pointerdown', (ev) => dragParam(ev, key, jack));
    attachTooltip(jack, () => {
      const i = slotForParam(settings.get('modSlots'), key);
      return i >= 0
        ? `${label} — patched from Function Gen ${i + 1}. Drag to move, drop in space to unplug.`
        : `${label} — drag to a generator OUT (or from one to here) to patch.`;
    });
    const l = document.createElement('span');
    l.textContent = label;
    cell.append(jack, l);
    grid.appendChild(cell);
    paramJacks.set(key, jack);
  }

  for (const field of buildFaceplate()) {
    const el = document.createElement('div');
    el.className = 'rw-pb-field';
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = field.title;
    const grid = document.createElement('div');
    grid.className = 'rw-pb-grid';
    for (const p of field.params) addParamCell(grid, p.key, p.label);
    el.append(t, grid);
    (field.column === 1 ? col1 : col2).appendChild(el);
  }

  // CV OUT module — real jacks for the cv:N virtual targets (the rack
  // skin skips these; here they have a home). Rebuilt when channels
  // change in I/O → CV Out.
  const cvField = document.createElement('div');
  cvField.className = 'rw-pb-field';
  col2.appendChild(cvField);
  function rebuildCvField(): void {
    for (const [key] of paramJacks) {
      if (key.startsWith('cv:')) paramJacks.delete(key);
    }
    cvField.replaceChildren();
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = 'CV OUT';
    const grid = document.createElement('div');
    grid.className = 'rw-pb-grid';
    cvField.append(t, grid);
    for (const opt of cvOutputTargets(settings)) {
      addParamCell(grid, String(opt.v), opt.l.replace(/^CV Out:\s*/, ''));
    }
  }
  rebuildCvField();
  settings.subscribe('cvOutputChannels', rebuildCvField);

  surface.append(rail, col1, col2);

  // ---------------- slot value refresh --------------------------------
  function refreshSlots(): void {
    const slots = settings.get('modSlots');
    slotRefs.forEach((r, i) => {
      const s = slots[i];
      if (!s) return;
      r.en.checked = s.enabled;
      if (document.activeElement !== r.rate) r.rate.value = String(s.frequency);
      if (document.activeElement !== r.amount) r.amount.value = String(s.amount);
      r.srcLcd.textContent = String(s.source).toUpperCase();
    });
  }
  settings.subscribe('modSlots', refreshSlots);
  refreshSlots();

  // ---------------- cable rendering -----------------------------------
  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  let dashOffset = 0;
  let lastT = 0;

  function frame(t: number): void {
    requestAnimationFrame(frame);
    if (!root.isConnected || !ctx) return;
    const dt = (t - lastT) / 1000;
    lastT = t;
    if (!reduceMotion) dashOffset += dt * 24;

    const rect = surface.getBoundingClientRect();
    if (rect.width === 0) return;
    // Popout-safety, same as RackLayer: an adopted 2D canvas can lose
    // its buffer — recreate it in the view's current document.
    if (canvas.ownerDocument !== root.ownerDocument) {
      canvas.remove();
      canvas = root.ownerDocument.createElement('canvas');
      canvas.className = 'rw-pb-cables';
      surface.insertBefore(canvas, surface.firstChild);
      ctx = canvas.getContext('2d');
      if (!ctx) return;
    }
    const win = root.ownerDocument.defaultView ?? window;
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.floor(rect.width), h = Math.floor(rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const local = (p: Pt): Pt => ({ x: p.x - rect.left, y: p.y - rect.top });
    const anchor = (el: HTMLElement | undefined): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? rectCenter(r) : null;
    };

    const slots = settings.get('modSlots');
    const plugged = new Set<string>();

    for (const c of classicCables(slots)) {
      if (pending?.kind === 'to-param' && pending.slotIndex === c.slotIndex) continue;
      const a = anchor(slotOutJacks.get(c.slotIndex));
      const b = anchor(paramJacks.get(c.target));
      if (!a || !b) continue;
      plugged.add(c.target);
      drawPatchCable(ctx, local(a), local(b), CLASSIC_COLOR, {
        style: 'sag', dim: !c.enabled, dashed: !reduceMotion && c.enabled, dashOffset,
      });
    }

    // Source cables: SOURCES jack → SRC IN, for jackable sources.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const srcJack = srcJacks.get(s?.source as ModSource);
      if (!s || !srcJack) continue;
      const a = anchor(srcJack);
      const b = anchor(slotSrcJacks.get(i));
      if (!a || !b) continue;
      drawPatchCable(ctx, local(a), local(b), SOURCE_COLOR, {
        style: 'sag', dim: !s.enabled, dashed: false,
      });
    }

    // Graph binding cables, read-only from the GRAPH ENGINE chip.
    const g = anchor(graphChip.querySelector('.rw-pb-jack--graph') as HTMLElement ?? graphChip);
    if (g) {
      for (const gc of graphCables(settings.get('modGraph'))) {
        const b = anchor(paramJacks.get(gc.paramKey));
        if (!b) continue;
        plugged.add(gc.paramKey);
        drawPatchCable(ctx, local(g), local(b), GRAPH_COLOR, {
          style: 'sag', dim: !gc.enabled, dashed: false,
        });
      }
    }

    if (pending) {
      const fixed = pending.kind === 'to-param' ? slotOutJacks.get(pending.slotIndex)
        : pending.kind === 'to-slotout' ? paramJacks.get(pending.paramKey)
        : srcJacks.get(pending.source);
      const a = anchor(fixed);
      if (a) {
        drawPatchCable(ctx, local(a), local(pending.pos), pending.kind === 'to-slotsrc' ? SOURCE_COLOR : CLASSIC_COLOR, {
          style: 'sag', highlight: true, dashed: !reduceMotion, dashOffset,
        });
      }
    }

    for (const [key, el] of paramJacks) {
      el.classList.toggle('rw-rack-jack--plugged', plugged.has(key));
    }
    for (const [i, el] of slotOutJacks) {
      el.classList.toggle('rw-rack-jack--plugged', slots[i] ? slots[i].target !== 'none' : false);
    }
  }
  requestAnimationFrame(frame);

  return root;
}
