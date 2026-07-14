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
import { drawPatchCable, fitCableCanvas } from '../cableDraw';
import { attachTooltip } from '../tooltip';
import {
  classicCables, graphCables, applyCableTarget, applyCableSource,
  slotForParam, nearestJack, rectCenter, Pt,
} from '../rack/rackGeometry';
import { buildFaceplate, SOURCE_JACKS } from './patchbayLayout';
import { cvOutputTargets } from '../targets';
import type { VideoSourceManager } from '../../input/sources';

const CLASSIC_COLOR = '#5fff85';
const SOURCE_COLOR  = '#b9ffd0';
const GRAPH_COLOR   = '#5fffd0';
const SNAP_PX = 26;

type JackId =
  | { kind: 'param'; key: string }
  | { kind: 'slotout'; index: number }
  | { kind: 'slotsrc'; index: number }
  | { kind: 'src'; source: ModSource };

export function createPatchBayView(settings: SettingsStore, source: VideoSourceManager): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-patchbay';

  const surface = document.createElement('div');
  surface.className = 'rw-pb-surface';
  root.appendChild(surface);

  // Narrow mode: below ~900px the three deck columns stack vertically
  // so the whole patch stays visible (vertical scroll, no horizontal
  // truncation) — the bay must work in a 400px side window as well as
  // the full center (workspace design system: any view, any window).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      root.classList.toggle('rw-pb--narrow', w > 0 && w < 900);
    }).observe(root);
  }

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

  // VIDEO SOURCE module — the same `VideoSourceManager` instance Controls
  // uses, so switching here (or there) is the SAME state, not a mirror:
  // no separate "patch bay video source" concept to fall out of sync.
  // No jack (it feeds the mesh upstream of everything patchable here,
  // same reasoning `cols`/`scanRate` stay off the modulation TARGETS
  // list — a one-shot device/stream choice, not a continuous signal).
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const title = document.createElement('span');
    title.textContent = 'VIDEO SOURCE';
    head.append(title);
    const lcdRow = document.createElement('div');
    lcdRow.className = 'rw-pb-row';
    const lcd = document.createElement('span');
    lcd.className = 'rw-pb-lcd';
    lcdRow.append(lcd);
    const btnRow = document.createElement('div');
    btnRow.className = 'rw-pb-row';
    const mkBtn = (label: string, tooltip: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-pb-tidy';
      b.textContent = label;
      attachTooltip(b, tooltip);
      b.addEventListener('click', run);
      btnRow.appendChild(b);
      return b;
    };
    mkBtn('WEBCAM', 'Switch to the default webcam.', () => { void source.useWebcam(); });
    mkBtn('SCREEN', 'Switch to a screen/window/tab share.', () => { void source.useScreen(); });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) source.useFile(f);
      fileInput.value = '';
    });
    mkBtn('FILE', 'Load a local video file.', () => fileInput.click());
    mod.append(head, lcdRow, btnRow, fileInput);
    rail.appendChild(mod);
    source.subscribe((state) => {
      lcd.textContent = state.kind === 'none' ? 'NONE' : `${state.kind.toUpperCase()}: ${state.label || '—'}`;
    });
  }

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

  // SOURCES bus — a horizontal strip across the TOP of the bay, like a
  // hardware bus bar. Owner feedback drove this: with sources stacked
  // in the rail, four default-sine cables collapsed into one unreadable
  // vertical line. Spread across the top, every cable has a distinct
  // start point and drops visibly down to its module's SRC IN.
  const bus = document.createElement('div');
  bus.className = 'rw-pb-bus';
  {
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = 'SOURCES';
    bus.appendChild(t);
    const strip = document.createElement('div');
    strip.className = 'rw-pb-bus-strip';
    for (const s of SOURCE_JACKS) {
      const cell = document.createElement('div');
      cell.className = 'rw-pb-bus-cell';
      const jack = makeJack('rw-pb-jack--src');
      jack.addEventListener('pointerdown', (ev) => dragSource(ev, s.source, jack));
      attachTooltip(jack, `${s.label} — drag to a generator’s SRC IN.`);
      const l = document.createElement('span');
      l.textContent = s.label;
      cell.append(jack, l);
      strip.appendChild(cell);
      srcJacks.set(s.source, jack);
    }
    bus.appendChild(strip);
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
    const cvOpts = cvOutputTargets(settings);
    if (!cvOpts.length) {
      const hint = document.createElement('div');
      hint.className = 'rw-pb-hint';
      hint.textContent = 'No CV output channels yet — add them in I/O → CV Out and jacks appear here.';
      grid.appendChild(hint);
    }
    for (const opt of cvOpts) {
      addParamCell(grid, String(opt.v), opt.l.replace(/^CV Out:\s*/, ''));
    }
  }
  rebuildCvField();
  settings.subscribe('cvOutputChannels', rebuildCvField);

  const deck = document.createElement('div');
  deck.className = 'rw-pb-deck';
  deck.append(rail, col1, col2);

  // The BOARD is the zoomable layer (CSS transform scale) - the cable
  // canvas stays UNscaled in screen space and measures live jack rects,
  // so cables stay crisp at any zoom (the graph editor's proven trick).
  const board = document.createElement('div');
  board.className = 'rw-pb-board';
  board.append(bus, deck);
  surface.appendChild(board);

  let zoom = 1;
  // Always re-derives from ground truth (the real, JS-untouched
  // container size + free mode's real absolute content extent) rather
  // than reading board.scrollWidth — board's CSS width is a percentage
  // of `surface`, so reading its rendered size back would just echo
  // whatever surface was last set to and never shrink again on a later
  // plain window resize (the bug behind nodes not resizing going from
  // a maximized window back down to a smaller one).
  function syncSurfaceSize(): void {
    const baseW = root.clientWidth || board.scrollWidth;
    const baseH = root.clientHeight || board.scrollHeight;
    const contentW = freeMode ? Math.max(baseW, parseFloat(board.style.minWidth) || 0) : baseW;
    const contentH = freeMode ? Math.max(baseH, parseFloat(board.style.minHeight) || 0) : baseH;
    surface.style.width = `${contentW * zoom}px`;
    surface.style.height = `${contentH * zoom}px`;
  }
  function applyZoom(next: number, anchorX?: number, anchorY?: number): void {
    next = Math.max(0.4, Math.min(2, next));
    if (next === zoom) return;
    const prev = zoom;
    // Keep the point under the anchor (cursor or viewport center)
    // stationary by compensating the scroll position.
    const rr = root.getBoundingClientRect();
    const ax = anchorX !== undefined ? anchorX - rr.left : rr.width / 2;
    const ay = anchorY !== undefined ? anchorY - rr.top : rr.height / 2;
    const cx = root.scrollLeft + ax;
    const cy = root.scrollTop + ay;
    zoom = next;
    board.style.transform = `scale(${zoom})`;
    syncSurfaceSize();
    root.scrollLeft = cx * (zoom / prev) - ax;
    root.scrollTop = cy * (zoom / prev) - ay;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  // Wheel zoom (cursor-anchored) + traditional -/100%/+ buttons for
  // pointing devices without a wheel.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyZoom(zoom * Math.exp(-e.deltaY * 0.0012), e.clientX, e.clientY);
  }, { passive: false });

  // Click-drag-to-pan on empty background, the standard node-editor
  // canvas gesture (Blender/Unity/Figma): grab anywhere that ISN'T a
  // module, jack, or control and drag to scroll the board around.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target as HTMLElement;
    if (t.closest('.rw-pb-module, .rw-pb-field, .rw-pb-graph-chip, .rw-rack-jack, .rw-pb-bus-cell, input, select, button')) return;
    e.preventDefault();
    const pid = e.pointerId;
    const startX = e.clientX, startY = e.clientY;
    const startLeft = root.scrollLeft, startTop = root.scrollTop;
    let started = false;
    root.setPointerCapture(pid);
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started) {
        if (Math.hypot(dx, dy) < 4) return;
        started = true;
        root.classList.add('rw-pb-panning');
      }
      root.scrollLeft = startLeft - dx;
      root.scrollTop = startTop - dy;
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      root.releasePointerCapture(pid);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.classList.remove('rw-pb-panning');
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
  });

  const zoomBar = document.createElement('span');
  zoomBar.className = 'rw-pb-zoombar';
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'rw-pb-tidy';
  zoomOut.textContent = '-';
  attachTooltip(zoomOut, 'Zoom out (scroll wheel works anywhere on the board too).');
  zoomOut.addEventListener('click', () => applyZoom(zoom / 1.2));
  const zoomLabel = document.createElement('button');
  zoomLabel.type = 'button';
  zoomLabel.className = 'rw-pb-tidy';
  zoomLabel.textContent = '100%';
  attachTooltip(zoomLabel, 'Reset zoom to 100%.');
  zoomLabel.addEventListener('click', () => applyZoom(1));
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'rw-pb-tidy';
  zoomIn.textContent = '+';
  attachTooltip(zoomIn, 'Zoom in (scroll wheel works anywhere on the board too).');
  zoomIn.addEventListener('click', () => applyZoom(zoom * 1.2));
  zoomBar.append(zoomOut, zoomLabel, zoomIn);

  // ---------------- Max/MSP-style free layout -------------------------
  // Every module/field is draggable by its header. The stacked flow
  // layout is the tidy default; the FIRST drag freezes every unit at
  // its current position (re-parented to the surface, absolute), after
  // which units move freely like nodes in a patcher. TIDY restores the
  // flow. Cables follow automatically (anchors are live jack rects).
  // Free positions are session-local by design (the tidy layout is the
  // document; free layout is a workbench arrangement).
  let freeMode = false;
  // Baseline root width the current free-layout positions/widths were
  // measured against — lets the resize observer below rescale every
  // unit's left/width by the ratio of new/old width so a custom
  // arrangement shrinks and grows horizontally WITH the window instead
  // of holding fixed pixel geometry (owner bug report: nodes didn't
  // resize going from a maximized window back down to a smaller one).
  let freeRefWidth: number | null = null;
  interface UnitHome { unit: HTMLElement; parent: HTMLElement; next: Node | null }
  const unitHomes: UnitHome[] = [];

  const tidyBtn = document.createElement('button');
  tidyBtn.type = 'button';
  tidyBtn.className = 'rw-pb-tidy';
  tidyBtn.textContent = 'TIDY';
  attachTooltip(tidyBtn, 'Snap all modules back into the stacked layout (drag any module header to arrange freely, Max/MSP style).');
  tidyBtn.addEventListener('click', () => { suspendedFree = null; tidy(); });
  const pbTools = document.createElement('span');
  pbTools.className = 'rw-pb-tools';
  pbTools.append(zoomBar, tidyBtn);
  bus.appendChild(pbTools);

  function allUnits(): HTMLElement[] {
    return [
      bus,
      ...Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-module, .rw-pb-field, .rw-pb-graph-chip')),
    ];
  }

  function freeze(): void {
    if (freeMode) return;
    freeMode = true;
    const bRect = board.getBoundingClientRect();
    const placed = allUnits().map((unit) => ({ unit, r: unit.getBoundingClientRect() }));
    unitHomes.length = 0;
    for (const { unit } of placed) {
      unitHomes.push({ unit, parent: unit.parentElement!, next: unit.nextSibling });
    }
    // Two passes: measure everything first, THEN re-parent/absolutize
    // (in BOARD coordinates, dividing out the zoom).
    board.style.minHeight = `${board.scrollHeight}px`;
    board.style.minWidth = `${board.scrollWidth}px`;
    for (const { unit, r } of placed) {
      unit.classList.add('rw-pb-unit-free');
      unit.style.left = `${(r.left - bRect.left) / zoom}px`;
      unit.style.top = `${(r.top - bRect.top) / zoom}px`;
      unit.style.width = `${r.width / zoom}px`;
      board.appendChild(unit);
    }
    root.classList.add('rw-pb-freemode');
    freeRefWidth = root.getBoundingClientRect().width;
    syncSurfaceSize();
  }

  function tidy(): void {
    if (!freeMode) return;
    freeMode = false;
    freeRefWidth = null;
    for (const h of unitHomes) {
      h.unit.classList.remove('rw-pb-unit-free');
      h.unit.style.left = '';
      h.unit.style.top = '';
      h.unit.style.width = '';
      // The recorded next-sibling may itself have been re-parented to
      // the surface; unitHomes is in original DOM order, and the unit
      // parents hold only units, so appending in order reproduces the
      // flow exactly.
      if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(h.unit, h.next);
      else h.parent.appendChild(h.unit);
    }
    unitHomes.length = 0;
    board.style.minHeight = '';
    board.style.minWidth = '';
    root.classList.remove('rw-pb-freemode');
    syncSurfaceSize();
  }

  // Stack containers a dragged unit can reorder within (owner request:
  // drag-and-drop node ORDER inside the default vertical stacks, with
  // an insertion line; dragging away from every stack breaks the board
  // into free layout instead).
  const stacks = (): HTMLElement[] => [rail, col1, col2];
  const insertLine = document.createElement('div');
  insertLine.className = 'rw-pb-insertline';

  function stackUnder(x: number, y: number): HTMLElement | null {
    if (freeMode) return null;
    for (const c of stacks()) {
      const r = c.getBoundingClientRect();
      // Vertical extent ends at the LAST UNIT, not the flex column's box
      // (the columns stretch to the bay's full height, and their empty
      // tails would otherwise swallow every breakout drop).
      const units = Array.from(c.children).filter((el) => el !== insertLine) as HTMLElement[];
      const last = units[units.length - 1];
      const bottom = last ? last.getBoundingClientRect().bottom + 30 : r.top + 40;
      if (x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 10 && y <= bottom) return c;
    }
    return null;
  }

  function insertRefIn(container: HTMLElement, y: number, dragged: HTMLElement): HTMLElement | null {
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (child === dragged || child === insertLine) continue;
      const r = child.getBoundingClientRect();
      if (y < r.top + r.height / 2) return child;
    }
    return null;
  }

  function makeUnitDraggable(unit: HTMLElement, handle: HTMLElement): void {
    handle.classList.add('rw-pb-unit-handle');
    handle.addEventListener('pointerdown', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, select, button, .rw-rack-jack')) return;
      ev.preventDefault();
      const pid = ev.pointerId;
      const startX = ev.clientX, startY = ev.clientY;
      let started = false;
      let baseL = 0, baseT = 0;
      let stackTarget: HTMLElement | null = null;
      const canStack = unit !== bus; // the bus stays a top strip
      const doc = root.ownerDocument;

      const beginFree = (e: PointerEvent): void => {
        freeze();
        baseL = parseFloat(unit.style.left) || 0;
        baseT = parseFloat(unit.style.top) || 0;
        // Re-base the gesture so the unit doesn't jump.
        (unit.dataset.dragBaseX as unknown) = undefined;
        unit.classList.add('rw-pb-unit-dragging');
        void e;
      };

      const onMove = (e: PointerEvent): void => {
        if (e.pointerId !== pid) return;
        if (!started) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
          started = true;
          if (!freeMode) unit.classList.add('rw-pb-unit-lifting');
          else { beginFree(e); }
        }
        e.preventDefault();

        if (!freeMode) {
          // TIDY mode: reorder within a stack (insertion line), or lift
          // out past every stack to break into free layout on drop.
          stackTarget = canStack ? stackUnder(e.clientX, e.clientY) : null;
          if (stackTarget) {
            const ref = insertRefIn(stackTarget, e.clientY, unit);
            if (ref) stackTarget.insertBefore(insertLine, ref);
            else stackTarget.appendChild(insertLine);
          } else {
            insertLine.remove();
          }
          return;
        }

        // FREE mode: absolute move (pointer deltas are visual pixels;
        // unit coords are board units) + magnetic snapping to nearby
        // nodes (x-align, top-align, or stack directly beneath).
        let nl = Math.max(0, baseL + (e.clientX - startX) / zoom);
        let nt = Math.max(0, baseT + (e.clientY - startY) / zoom);
        const SNAP = 12;
        for (const other of Array.from(board.querySelectorAll<HTMLElement>('.rw-pb-unit-free'))) {
          if (other === unit) continue;
          const ol = parseFloat(other.style.left) || 0;
          const ot = parseFloat(other.style.top) || 0;
          const ow = other.offsetWidth, oh = other.offsetHeight;
          const xOverlap = nl < ol + ow && nl + unit.offsetWidth > ol;
          if (Math.abs(nl - ol) < SNAP) nl = ol;                        // left-align
          if (xOverlap && Math.abs(nt - (ot + oh + 10)) < SNAP) nt = ot + oh + 10; // stack below
          if (xOverlap && Math.abs(nt + unit.offsetHeight + 10 - ot) < SNAP) nt = ot - unit.offsetHeight - 10; // stack above
          if (Math.abs(nt - ot) < SNAP && !xOverlap) nt = ot;           // top-align
        }
        unit.style.left = `${nl}px`;
        unit.style.top = `${nt}px`;
        const need = nl + unit.offsetWidth + 24;
        if (need > board.offsetWidth) { board.style.minWidth = `${need}px`; syncSurfaceSize(); }
        const needH = nt + unit.offsetHeight + 24;
        if (needH > board.offsetHeight) { board.style.minHeight = `${needH}px`; syncSurfaceSize(); }
      };

      const onUp = (e: PointerEvent): void => {
        if (e.pointerId !== pid) return;
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerup', onUp);
        doc.removeEventListener('pointercancel', onUp);
        unit.classList.remove('rw-pb-unit-dragging', 'rw-pb-unit-lifting');
        if (!started) { insertLine.remove(); return; }
        if (!freeMode) {
          if (stackTarget && insertLine.parentNode === stackTarget) {
            // Reorder within/into the stack at the insertion line.
            stackTarget.insertBefore(unit, insertLine);
            insertLine.remove();
          } else {
            // Dropped away from every stack: break out to free layout
            // and place the unit under the pointer.
            insertLine.remove();
            freeze();
            const bRect = board.getBoundingClientRect();
            unit.style.left = `${Math.max(0, (e.clientX - bRect.left) / zoom - unit.offsetWidth / 2)}px`;
            unit.style.top = `${Math.max(0, (e.clientY - bRect.top) / zoom - 10)}px`;
            syncSurfaceSize();
          }
        }
      };
      doc.addEventListener('pointermove', onMove, { passive: false });
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onUp);
    });
  }

  // Handles: module heads, field titles, the bus title, the graph chip.
  for (const m of Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-module'))) {
    const head = m.querySelector<HTMLElement>('.rw-pb-module-head');
    if (head) makeUnitDraggable(m, head);
  }
  for (const f of Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-field'))) {
    const title = f.querySelector<HTMLElement>('.rw-pb-field-title');
    if (title) makeUnitDraggable(f, title);
  }
  {
    const busTitle = bus.querySelector<HTMLElement>('.rw-pb-field-title');
    if (busTitle) makeUnitDraggable(bus, busTitle);
  }
  makeUnitDraggable(graphChip, graphChip);

  // Narrow mode and free mode don't mix (narrow stacks the columns) —
  // but a custom node arrangement must SURVIVE the round-trip (owner
  // bug report): entering narrow suspends the free layout (positions
  // saved, board tidied); widening past the threshold re-freezes and
  // restores every node where it was. Only the TIDY button forgets.
  let suspendedFree: Array<{ unit: HTMLElement; left: string; top: string; width: string }> | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? root.clientWidth;
      const narrow = root.classList.contains('rw-pb--narrow');
      if (narrow && freeMode) {
        suspendedFree = allUnits().map((unit) => ({
          unit, left: unit.style.left, top: unit.style.top, width: unit.style.width,
        }));
        tidy();
      } else if (!narrow && suspendedFree) {
        const saved = suspendedFree;
        suspendedFree = null;
        freeze();
        for (const p of saved) {
          p.unit.style.left = p.left;
          p.unit.style.top = p.top;
          p.unit.style.width = p.width;
        }
        syncSurfaceSize();
        freeRefWidth = w;
      } else if (!narrow && freeMode) {
        // Continuous case: the window is shrinking/growing but never
        // crossed the narrow threshold. Rescale every free unit's
        // left/width by how much the container width changed since the
        // last measurement, so a custom layout tracks the window
        // horizontally instead of holding stale pixel geometry.
        if (freeRefWidth == null) freeRefWidth = w;
        else if (w > 0 && Math.abs(w - freeRefWidth) > 0.5) {
          const ratio = w / freeRefWidth;
          for (const unit of allUnits()) {
            if (!unit.classList.contains('rw-pb-unit-free')) continue;
            const l = parseFloat(unit.style.left) || 0;
            const uw = parseFloat(unit.style.width) || unit.offsetWidth;
            unit.style.left = `${l * ratio}px`;
            unit.style.width = `${uw * ratio}px`;
          }
          syncSurfaceSize();
          freeRefWidth = w;
        }
      }
      // Ground-truth resync on every resize (cheap, idempotent) — keeps
      // the scrollable surface correct even in plain flow mode after a
      // zoom action had previously locked in an explicit px size.
      syncSurfaceSize();
    }).observe(root);
  }

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
    // Coverage: the surface's box PLUS everything laid out inside it —
    // the board can be far taller than the surface's own box (the bay
    // root scrolls it), and a box-sized canvas only covered the top
    // scrollport-slice: cables to jacks below the fold drew into
    // clipped space and silently vanished. Children rects also include
    // the board's zoom transform and free-mode breakout units. The
    // canvas itself is deliberately excluded (see fitCableCanvas docs).
    let covW = rect.width, covH = rect.height;
    for (const child of Array.from(surface.children)) {
      if (child === canvas || !(child instanceof HTMLElement)) continue;
      const cr = child.getBoundingClientRect();
      covW = Math.max(covW, cr.right - rect.left);
      covH = Math.max(covH, cr.bottom - rect.top);
    }
    // Zoom-aware sizing (Global Text Size): keeps the canvas's VISUAL
    // size equal to the coverage so anchors measured in screen pixels
    // land exactly where drawn — see fitCableCanvas's docs.
    const { w, h } = fitCableCanvas(canvas, ctx, { width: covW, height: covH });
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
