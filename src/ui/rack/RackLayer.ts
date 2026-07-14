/**
 * RackLayer — the rack skin's live patch-cable surface.
 *
 * Active only while the skin is 'rack' (src/ui/skin.ts). Injects jack
 * elements next to every modulatable slider (input jacks) and onto each
 * Classic mod-slot card (output jacks), and draws cables on a canvas
 * overlay spanning the control panel:
 *
 *   - green cables  = Classic slots (slot output → target param input),
 *     DRAGGABLE: grab an output jack to patch/re-patch, grab a plugged
 *     input jack to move that cable, drop in empty space to unplug.
 *   - cyan cables   = Graph engine bindings (graph → target param),
 *     read-only here — the graph editor is their editing surface.
 *
 * Cable edits are PATCH DATA edits: they write `Settings.modSlots[i]
 * .target` through `settings.set`, the same path as the Modulation
 * section's Target dropdown (which updates live via its existing
 * subscription). Nothing here touches live values — the base/live split
 * is untouched by cables (skin invariants, PRINCIPLES.md).
 *
 * Anchoring: endpoints are resolved per frame from live DOM rects, with
 * a fallback chain for hidden endpoints — the row's jack if visible,
 * else its section's header (collapsed accordion), else the tab strip
 * (other tab). So a cable into a collapsed section visibly plugs into
 * that section's header instead of vanishing.
 */

import { subscribeSkin, getSkin } from '../skin';
import { TARGETS } from '../targets';
import type { SettingsStore, ModTarget } from '../../state/Settings';
import { drawPatchCable, fitCableCanvas } from '../cableDraw';
import { attachTooltip } from '../tooltip';
import {
  classicCables, graphCables, applyCableTarget, slotForParam,
  nearestJack, rectCenter, Pt,
} from './rackGeometry';
import './rack.css';

const CLASSIC_COLOR = '#5fff85';
const GRAPH_COLOR   = '#5fffd0';
const SNAP_PX = 28;

const TARGET_KEYS = new Set<string>(TARGETS.filter((t) => t.v !== 'none').map((t) => String(t.v)));

export interface RackLayerController { destroy(): void }

export function createRackLayer(panelRoot: HTMLElement, settings: SettingsStore): RackLayerController {
  let active = false;
  let raf = 0;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let observer: MutationObserver | null = null;
  let needsInject = false;
  let dashOffset = 0;
  let lastTime = 0;

  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /** paramKey -> injected input jack element. */
  const paramJacks = new Map<string, HTMLElement>();
  /** slotIndex -> injected output jack element. */
  const slotJacks = new Map<number, HTMLElement>();

  /**
   * In-progress drag (viewport coords). Bidirectional (Phase 0 of the
   * workspace plan — an empty input jack doing nothing on drag read as
   * "cables are broken" to the owner):
   *   'to-param' — fixed end at slot `slotIndex`'s output jack; loose
   *                end seeks param INPUT jacks.
   *   'to-slot'  — fixed end at `paramKey`'s input jack; loose end
   *                seeks slot OUTPUT jacks.
   */
  type Pending =
    | { kind: 'to-param'; slotIndex: number; pos: Pt; hover: string | null }
    | { kind: 'to-slot'; paramKey: string; pos: Pt; hover: number | null };
  let pending: Pending | null = null;

  // ------------------------------------------------------------------
  // Jack injection
  // ------------------------------------------------------------------

  function injectJacks(): void {
    const doc = panelRoot.ownerDocument;

    for (const el of Array.from(panelRoot.querySelectorAll<HTMLElement>('.rw-slider[data-param-key]'))) {
      const key = el.dataset.paramKey!;
      if (!TARGET_KEYS.has(key) || paramJacks.has(key)) continue;
      const jack = doc.createElement('span');
      jack.className = 'rw-rack-jack rw-rack-jack--in';
      jack.dataset.rackJack = key;
      attachTooltip(jack, () => {
        const i = slotForParam(settings.get('modSlots'), key);
        return i >= 0
          ? `Patched from Classic slot ${i + 1} — drag to move the cable, drop in space to unplug.`
          : 'Modulation input — drag from here to a slot’s output jack (or the other way around) to patch it.';
      });
      jack.addEventListener('pointerdown', (ev) => {
        const i = slotForParam(settings.get('modSlots'), key);
        if (i >= 0) beginDrag(ev, i, jack);
        else beginReverseDrag(ev, key, jack);
      });
      el.appendChild(jack);
      paramJacks.set(key, jack);
    }

    for (const card of Array.from(panelRoot.querySelectorAll<HTMLElement>('.rw-mod-slot[data-mod-slot]'))) {
      const index = Number(card.dataset.modSlot);
      if (!Number.isFinite(index) || slotJacks.has(index)) continue;
      const jack = doc.createElement('span');
      jack.className = 'rw-rack-jack rw-rack-jack--out';
      jack.dataset.rackJackOut = String(index);
      attachTooltip(jack, 'Slot output — drag a cable to any param’s input jack; drop in space to unplug.');
      jack.addEventListener('pointerdown', (ev) => beginDrag(ev, index, jack));
      (card.querySelector('.rw-mod-slot-row') ?? card).appendChild(jack);
      slotJacks.set(index, jack);
    }
  }

  // ------------------------------------------------------------------
  // Anchoring (viewport coords; the draw pass subtracts the panel rect)
  // ------------------------------------------------------------------

  function visibleRect(el: HTMLElement | null): DOMRect | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  /** Jack itself → its section's header → the tab strip. Null = undrawable. */
  function anchorFor(jack: HTMLElement): Pt | null {
    const own = visibleRect(jack);
    if (own) return rectCenter(own);
    const head = visibleRect(jack.closest<HTMLElement>('.rw-section')?.querySelector('.rw-section-head') ?? null);
    if (head) return { x: head.right - 14, y: head.top + head.height / 2 };
    const tabs = visibleRect(panelRoot.querySelector('.rw-tabs'));
    if (tabs) return { x: tabs.left + tabs.width / 2, y: tabs.bottom - 4 };
    return null;
  }

  /** Anchor for the graph engine's end of a binding cable: the section
   *  that hosts the Modulation UI (located via any slot card). */
  function graphSourceAnchor(): Pt | null {
    const card = panelRoot.querySelector<HTMLElement>('.rw-mod-slot[data-mod-slot]');
    if (!card) return null;
    const head = visibleRect(card.closest<HTMLElement>('.rw-section')?.querySelector('.rw-section-head') ?? null);
    if (head) return { x: head.left + 14, y: head.top + head.height / 2 };
    const tabs = visibleRect(panelRoot.querySelector('.rw-tabs'));
    return tabs ? { x: tabs.left + tabs.width / 2, y: tabs.bottom - 4 } : null;
  }

  // ------------------------------------------------------------------
  // Drag-to-patch
  // ------------------------------------------------------------------

  /** Shared gesture runner for both drag directions. `hoverEl` maps the
   *  current snap hit to the jack element that should light up. */
  function runGesture(
    ev: PointerEvent,
    grabbedJack: HTMLElement,
    onMovePos: (pos: Pt) => void,
    onDrop: () => void,
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const doc = panelRoot.ownerDocument;
    const activeId = ev.pointerId;
    panelRoot.classList.add('rw-rack-dragging');
    // Immediate feedback on the grabbed jack, independent of the cable
    // canvas — a drag must visibly respond even if drawing is broken.
    grabbedJack.classList.add('rw-rack-jack--grab');

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      onMovePos({ x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      doc.removeEventListener('pointermove',   onMove);
      doc.removeEventListener('pointerup',     onUp);
      doc.removeEventListener('pointercancel', onUp);
      panelRoot.classList.remove('rw-rack-dragging');
      grabbedJack.classList.remove('rw-rack-jack--grab');
      onDrop();
    };
    doc.addEventListener('pointermove',   onMove, { passive: false });
    doc.addEventListener('pointerup',     onUp);
    doc.addEventListener('pointercancel', onUp);
  }

  function jackCenters<K>(jacks: Map<K, HTMLElement>): Array<Pt & { id: K }> {
    const out: Array<Pt & { id: K }> = [];
    for (const [id, el] of jacks) {
      const r = visibleRect(el);
      if (r) out.push({ id, ...rectCenter(r) });
    }
    return out;
  }

  /** Drag a slot's cable by its loose (param) end. */
  function beginDrag(ev: PointerEvent, slotIndex: number, grabbedJack: HTMLElement): void {
    const p: Pending = { kind: 'to-param', slotIndex, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, grabbedJack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(jackCenters(paramJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) {
          if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
          p.hover = hit?.id ?? null;
          if (p.hover) paramJacks.get(p.hover)?.classList.add('rw-rack-jack--hover');
        }
      },
      () => {
        if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
        pending = null;
        const slots = settings.get('modSlots');
        const next = p.hover ?? 'none';
        if (slots[slotIndex] && slots[slotIndex].target !== next) {
          settings.set('modSlots', applyCableTarget(slots, slotIndex, next as ModTarget | 'none'));
        }
      });
  }

  /** Drag from an UNPLUGGED input jack: the loose end seeks slot output
   *  jacks; dropping on one patches that slot to this param. */
  function beginReverseDrag(ev: PointerEvent, paramKey: string, grabbedJack: HTMLElement): void {
    const p: Pending = { kind: 'to-slot', paramKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, grabbedJack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(jackCenters(slotJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) {
          if (p.hover != null) slotJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
          p.hover = hit?.id ?? null;
          if (p.hover != null) slotJacks.get(p.hover)?.classList.add('rw-rack-jack--hover');
        }
      },
      () => {
        if (p.hover != null) slotJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
        pending = null;
        if (p.hover == null) return; // dropped in space — nothing was plugged
        const slots = settings.get('modSlots');
        if (slots[p.hover] && slots[p.hover].target !== paramKey) {
          settings.set('modSlots', applyCableTarget(slots, p.hover, paramKey as ModTarget));
        }
      });
  }

  // ------------------------------------------------------------------
  // Per-frame draw
  // ------------------------------------------------------------------

  function frame(t: number): void {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = (t - lastTime) / 1000;
    lastTime = t;
    if (!reduceMotion) dashOffset += dt * 24;

    if (needsInject) { needsInject = false; injectJacks(); }
    if (!canvas || !ctx) return;

    // Popout-safe: PanelPopout adoptNode's the panel (and this canvas)
    // into another window's document, and an adopted 2D canvas can lose
    // its context/buffer. Recreate it in the panel's CURRENT document
    // whenever they diverge (also covers pop-in back to the main window).
    if (canvas.ownerDocument !== panelRoot.ownerDocument) {
      canvas.remove();
      canvas = panelRoot.ownerDocument.createElement('canvas');
      canvas.className = 'rw-rack-cables';
      ctx = canvas.getContext('2d');
      panelRoot.appendChild(canvas);
      if (!ctx) return;
    }

    const panelRect = panelRoot.getBoundingClientRect();
    // Zoom-aware sizing (Global Text Size) — see fitCableCanvas's docs.
    // Coverage is the panel's own box (its content scrolls inside a
    // contained scroller, so nothing legitimately overflows it).
    const { w, h } = fitCableCanvas(canvas, ctx, { width: panelRect.width, height: panelRect.height });
    ctx.clearRect(0, 0, w, h);

    const local = (p: Pt): Pt => ({ x: p.x - panelRect.left, y: p.y - panelRect.top });
    const plugged = new Set<string>();

    // Classic cables (+ the one being dragged, which follows the pointer).
    const slots = settings.get('modSlots');
    for (const c of classicCables(slots)) {
      if (pending?.kind === 'to-param' && pending.slotIndex === c.slotIndex) continue;
      const jack = paramJacks.get(c.target);
      const outJack = slotJacks.get(c.slotIndex);
      if (!jack || !outJack) continue;
      const a = anchorFor(outJack);
      const b = anchorFor(jack);
      if (!a || !b) continue;
      plugged.add(c.target);
      drawPatchCable(ctx, local(a), local(b), CLASSIC_COLOR, {
        style: 'sag', dim: !c.enabled, dashed: !reduceMotion && c.enabled, dashOffset,
      });
    }

    // Graph binding cables — read-only, one per enabled binding.
    const src = graphSourceAnchor();
    if (src) {
      for (const g of graphCables(settings.get('modGraph'))) {
        const jack = paramJacks.get(g.paramKey);
        if (!jack) continue;
        const b = anchorFor(jack);
        if (!b) continue;
        plugged.add(g.paramKey);
        drawPatchCable(ctx, local(src), local(b), GRAPH_COLOR, {
          style: 'sag', dim: !g.enabled, dashed: false,
        });
      }
    }

    // Pending (dragged) cable, highlighted, loose end on the pointer.
    if (pending) {
      const fixedJack = pending.kind === 'to-param'
        ? slotJacks.get(pending.slotIndex)
        : paramJacks.get(pending.paramKey);
      const a = fixedJack ? anchorFor(fixedJack) : null;
      if (a) {
        drawPatchCable(ctx, local(a), local(pending.pos), CLASSIC_COLOR, {
          style: 'sag', highlight: true, dashed: !reduceMotion, dashOffset,
        });
      }
    }

    // Lit ring on plugged input jacks (DOM write only on state change).
    for (const [key, el] of paramJacks) {
      el.classList.toggle('rw-rack-jack--plugged', plugged.has(key));
    }
    for (const [i, el] of slotJacks) {
      el.classList.toggle('rw-rack-jack--plugged',
        slots[i] ? slots[i].target !== 'none' : false);
    }
  }

  // ------------------------------------------------------------------
  // Activation
  // ------------------------------------------------------------------

  function activate(): void {
    if (active) return;
    active = true;
    const doc = panelRoot.ownerDocument;
    canvas = doc.createElement('canvas');
    canvas.className = 'rw-rack-cables';
    ctx = canvas.getContext('2d');
    panelRoot.appendChild(canvas);
    injectJacks();
    // Sections can mount after boot (lazy panels); pick up their rows.
    observer = new MutationObserver(() => { needsInject = true; });
    observer.observe(panelRoot, { childList: true, subtree: true });
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function deactivate(): void {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    observer = null;
    canvas?.remove();
    canvas = null;
    ctx = null;
    pending = null;
    panelRoot.classList.remove('rw-rack-dragging');
    // Injected jacks stay in the DOM (CSS hides them outside the rack
    // skin) so a skin round-trip doesn't rebuild listeners.
  }

  const unsub = subscribeSkin((s) => { if (s === 'rack') activate(); else deactivate(); });
  // subscribeSkin fires immediately, so a stored 'rack' preference
  // activates on boot without an extra getSkin() check.
  void getSkin;

  return {
    destroy(): void {
      unsub();
      deactivate();
      for (const el of paramJacks.values()) el.remove();
      for (const el of slotJacks.values()) el.remove();
      paramJacks.clear();
      slotJacks.clear();
    },
  };
}
