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
 *     DRAGGABLE by their param end: grab the plugged input jack to move
 *     the cable to another param, drop in space to unplug.
 *   - every jacked slider also has an OUTPUT jack: drag it onto another
 *     param's input to patch param → param. That creates/reuses the same
 *     `param-out` graph node the Patch Bay uses (rackGeometry
 *     `bindParamOut`), so the cable shows in the Patch Bay too, and its
 *     cyan cable starts at this slider's OUT jack.
 *
 * Cable edits are PATCH DATA edits: they write `Settings.modSlots[i]
 * .target` (or `modGraph`, plus `engine.setPatch` — the graph's
 * two-write rule) through `settings.set`, the same path as the Modulation
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
import type { GraphPatch } from '../../modulation/graph/types';
import type { GraphEngine } from '../../modulation/graph/GraphEngine';
import { drawPatchCable, fitCableCanvas } from '../cableDraw';
import { attachTooltip, scheduleTooltip, cancelTooltip, flashTooltip } from '../tooltip';
import { rejectReason, TWO_WAY_PATCHING, outputHint, type JackKind } from './patchRules';
import {
  classicCables, graphCables, applyCableTarget, slotForParam,
  nearestJack, rectCenter, Pt,
  graphBindingForParam, applyGraphBindingTarget, bindParamOut, paramOutKeyOf,
} from './rackGeometry';
import './rack.css';
import './jackRipple.css';

const CLASSIC_COLOR = '#5fff85';
const GRAPH_COLOR   = '#5fffd0';
const SNAP_PX = 28;
/** Drag cable end colors — white = will connect, red = won't (the same
 *  pair the Patch Bay uses). */
const CABLE_ACCEPT_COLOR = '#ffffff';
const CABLE_REJECT_COLOR = '#ff5566';
const REJECT_TIP_MS = 180;
const ON_JACK_PX = 10;

const TARGET_KEYS = new Set<string>(TARGETS.filter((t) => t.v !== 'none').map((t) => String(t.v)));

export interface RackLayerController { destroy(): void }

export function createRackLayer(
  panelRoot: HTMLElement,
  settings: SettingsStore,
  /** Graph engine handle for graph-cable edits (modGraph writes must also
   *  reach `engine.setPatch` — the engine never re-reads Settings). */
  getEngine?: () => Promise<GraphEngine>,
): RackLayerController {
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
  /** paramKey -> injected param OUTPUT jack (param → param patching). */
  const paramOutJacks = new Map<string, HTMLElement>();

  /**
   * In-progress drag (viewport coords). Bidirectional (Phase 0 of the
   * workspace plan — an empty input jack doing nothing on drag read as
   * "cables are broken" to the owner):
   *   'to-param' — fixed end at slot `slotIndex`'s output jack; loose
   *                end seeks param INPUT jacks.
   *   'to-slot'  — fixed end at `paramKey`'s input jack; loose end
   *                seeks slot OUTPUT jacks or other params' OUTPUT jacks.
   *   'graph-to-param' — a graph binding's param end being moved; fixed
   *                end at the binding's source; seeks param INPUT jacks.
   *   'pout-to-param' — fixed end at `paramKey`'s OUTPUT jack; loose end
   *                seeks other params' INPUT jacks.
   */
  type OutHover = { kind: 'slot'; index: number } | { kind: 'pout'; key: string } | null;
  type Pending =
    | { kind: 'to-param'; slotIndex: number; pos: Pt; hover: string | null }
    | { kind: 'to-slot'; paramKey: string; pos: Pt; hover: OutHover }
    | { kind: 'graph-to-param'; bindingId: string; pos: Pt; hover: string | null }
    | { kind: 'pout-to-param'; paramKey: string; pos: Pt; hover: string | null };
  let pending: Pending | null = null;

  // ------------------------------------------------------------------
  // Jack injection
  // ------------------------------------------------------------------

  function injectJacks(): void {
    const doc = panelRoot.ownerDocument;

    for (const el of Array.from(panelRoot.querySelectorAll<HTMLElement>('.rw-slider[data-param-key]'))) {
      const key = el.dataset.paramKey!;
      if (!TARGET_KEYS.has(key) || paramJacks.get(key)?.isConnected) continue;   // a rebuilt row (new element, same key) needs fresh jacks
      const jack = doc.createElement('span');
      jack.className = 'rw-rack-jack rw-rack-jack--in';
      jack.dataset.rackJack = key;
      attachTooltip(jack, () => {
        const i = slotForParam(settings.get('modSlots'), key);
        return i >= 0
          ? `Patched from Classic slot ${i + 1} — drag to move the cable, drop in space to unplug.`
          : TWO_WAY_PATCHING
            ? 'Modulation input — drag from here to a slot’s output jack (or the other way around) to patch it.'
            : 'Modulation input — drag a cable into it from an output jack (a modulation slot’s OUT, or another knob’s OUT).';
      });
      jack.addEventListener('pointerdown', (ev) => {
        const i = slotForParam(settings.get('modSlots'), key);
        if (i >= 0) { beginDrag(ev, i, jack); return; }
        const bindingId = graphBindingForParam(settings.get('modGraph'), key);
        if (bindingId) { beginGraphDrag(ev, bindingId, jack); return; }
        if (TWO_WAY_PATCHING) { beginReverseDrag(ev, key, jack); return; }
        // One-way patching: an empty input can't start a cable.
        ev.preventDefault();
        ev.stopPropagation();
        flashTooltip(jack, outputHint('param-in', 'controls'));
      });
      el.appendChild(jack);
      paramJacks.set(key, jack);

      // Output jack: this param's live value as a signal (param → param).
      const out = doc.createElement('span');
      out.className = 'rw-rack-jack rw-rack-jack--out rw-rack-jack--pout';
      out.dataset.rackJackPout = key;
      attachTooltip(out, 'Parameter output — drag to another parameter’s input jack to modulate it with this one (shows in the Patch Bay too).');
      out.addEventListener('pointerdown', (ev) => beginParamOutDrag(ev, key, out));
      el.appendChild(out);
      paramOutJacks.set(key, out);
    }

    for (const card of Array.from(panelRoot.querySelectorAll<HTMLElement>('.rw-mod-slot[data-mod-slot]'))) {
      const index = Number(card.dataset.modSlot);
      if (!Number.isFinite(index) || slotJacks.get(index)?.isConnected) continue;
      const jack = doc.createElement('span');
      jack.className = 'rw-rack-jack rw-rack-jack--out';
      jack.dataset.rackJackOut = String(index);
      attachTooltip(jack, 'Slot output — drag a cable to any param’s input jack; drop in space to unplug.');
      jack.addEventListener('pointerdown', (ev) => beginDrag(ev, index, jack));
      (card.querySelector('.rw-mod-slot-tools-group--end') ?? card.querySelector('.rw-mod-slot-row') ?? card).appendChild(jack);
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

  /** True when a cable end would only be drawn at a fallback spot (its
   *  jack is hidden — collapsed section or another tab). */
  function hidden(jack: HTMLElement | undefined): boolean {
    return !jack || !visibleRect(jack);
  }
  /** A cable is worth drawing only if at least one real end is on screen.
   *  With BOTH ends hidden, both fall back to the same header or tab
   *  strip and the cable degenerates into a stray stub (owner report: a
   *  tracer under the I/O tab for a patch that lives on the Synth tab). */
  function drawable(a: HTMLElement | undefined, b: HTMLElement | undefined): boolean {
    return !(hidden(a) && hidden(b));
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
      probeReject({ x: e.clientX, y: e.clientY }, grabbedJack);
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      doc.removeEventListener('pointermove',   onMove);
      doc.removeEventListener('pointerup',     onUp);
      doc.removeEventListener('pointercancel', onUp);
      panelRoot.classList.remove('rw-rack-dragging', 'rw-rack-cursor-accept', 'rw-rack-cursor-reject');
      grabbedJack.classList.remove('rw-rack-jack--grab');
      onDrop();
      setRejectJack(null, '');
      cancelTooltip(doc);
    };
    doc.addEventListener('pointermove',   onMove, { passive: false });
    doc.addEventListener('pointerup',     onUp);
    doc.addEventListener('pointercancel', onUp);
  }

  // "Why won't this connect" — a jack near the pointer that the drag
  // won't snap to lights red with a short explanation (patchRules.ts,
  // shared with the Patch Bay).
  let rejectJack: HTMLElement | null = null;
  function setRejectJack(el: HTMLElement | null, reason: string): void {
    if (el === rejectJack) return;
    rejectJack?.classList.remove('rw-rack-jack--reject');
    rejectJack = el;
    if (el) {
      el.classList.add('rw-rack-jack--reject');
      scheduleTooltip(panelRoot.ownerDocument, reason, el, REJECT_TIP_MS);
    } else {
      cancelTooltip(panelRoot.ownerDocument);
    }
  }
  function classifyJack(el: HTMLElement): { kind: JackKind; key: string } | null {
    for (const [k, v] of paramJacks) if (v === el) return { kind: 'param-in', key: k };
    for (const [k, v] of paramOutJacks) if (v === el) return { kind: 'param-out', key: k };
    for (const [k, v] of slotJacks) if (v === el) return { kind: 'slot-out', key: String(k) };
    return null;
  }
  function dragOrigin(p: Pending): { kind: JackKind; key: string; bindingReroute?: boolean } {
    switch (p.kind) {
      case 'to-param': return { kind: 'slot-out', key: String(p.slotIndex) };
      case 'to-slot': return { kind: 'param-in', key: p.paramKey };
      case 'graph-to-param': return { kind: 'node-out', key: p.bindingId, bindingReroute: true };
      case 'pout-to-param': return { kind: 'param-out', key: p.paramKey };
    }
  }
  function probeReject(pos: Pt, grabbed: HTMLElement): void {
    const p = pending;
    if (!p) { setRejectJack(null, ''); return; }
    let best: HTMLElement | null = null;
    let bestD = SNAP_PX;
    for (const el of [...paramJacks.values(), ...paramOutJacks.values(), ...slotJacks.values()]) {
      if (el === grabbed) continue;
      const r = visibleRect(el);
      if (!r) continue;
      const d = Math.hypot(r.left + r.width / 2 - pos.x, r.top + r.height / 2 - pos.y);
      if (d < bestD) { bestD = d; best = el; }
    }
    if (p.hover != null) {
      // Valid jack in range wins, unless the pointer is right ON a jack
      // that won't take this cable (IN/OUT sit side by side).
      const valid = panelRoot.querySelector<HTMLElement>('.rw-rack-jack--hover');
      if (!best || best === valid || bestD > ON_JACK_PX) { setRejectJack(null, ''); return; }
      valid?.classList.remove('rw-rack-jack--hover');
      (p as { hover: unknown }).hover = null;
    }
    const to = best ? classifyJack(best) : null;
    const from = dragOrigin(p);
    if (!best || !to || (to.kind === from.kind && to.key === from.key)) { setRejectJack(null, ''); return; }
    const sameParam = ((from.kind === 'param-out' && to.kind === 'param-in') || (from.kind === 'param-in' && to.kind === 'param-out'))
      && from.key === to.key;
    setRejectJack(best, rejectReason(from.kind, to.kind, { sameParam, bindingReroute: from.bindingReroute }));
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
   *  jacks or another param's output jack; dropping on a slot patches that
   *  slot to this param, dropping on a param output patches param → param. */
  function beginReverseDrag(ev: PointerEvent, paramKey: string, grabbedJack: HTMLElement): void {
    const p: Pending = { kind: 'to-slot', paramKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const elFor = (h: OutHover): HTMLElement | undefined => (
      h?.kind === 'slot' ? slotJacks.get(h.index) : h?.kind === 'pout' ? paramOutJacks.get(h.key) : undefined);
    runGesture(ev, grabbedJack,
      (pos) => {
        p.pos = pos;
        const slotHit = nearestJack(jackCenters(slotJacks), pos, SNAP_PX);
        const poutHit = nearestJack(jackCenters(paramOutJacks).filter((c) => c.id !== paramKey), pos, SNAP_PX);
        const dist = (h: Pt | null): number => (h ? Math.hypot(h.x - pos.x, h.y - pos.y) : Infinity);
        const next: OutHover = !slotHit && !poutHit ? null
          : dist(slotHit) <= dist(poutHit) ? { kind: 'slot', index: slotHit!.id }
          : { kind: 'pout', key: poutHit!.id };
        const same = next?.kind === p.hover?.kind
          && (next?.kind === 'slot' ? next.index === (p.hover as { index: number }).index
            : next?.kind === 'pout' ? next.key === (p.hover as { key: string }).key : true);
        if (!same) {
          elFor(p.hover)?.classList.remove('rw-rack-jack--hover');
          p.hover = next;
          elFor(p.hover)?.classList.add('rw-rack-jack--hover');
        }
      },
      () => {
        elFor(p.hover)?.classList.remove('rw-rack-jack--hover');
        pending = null;
        const h = p.hover;
        if (!h) return; // dropped in space — nothing was plugged
        if (h.kind === 'pout') { commitGraph(bindParamOut(settings.get('modGraph'), h.key, paramKey)); return; }
        const slots = settings.get('modSlots');
        if (slots[h.index] && slots[h.index].target !== paramKey) {
          settings.set('modSlots', applyCableTarget(slots, h.index, paramKey as ModTarget));
        }
      });
  }

  /** Move a graph binding's param end: snap to another param's input, or
   *  drop in space to unplug (binding kept, retargeted to 'none' — the
   *  same non-destructive unplug the Patch Bay uses). */
  function beginGraphDrag(ev: PointerEvent, bindingId: string, grabbedJack: HTMLElement): void {
    const p: Pending = { kind: 'graph-to-param', bindingId, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    // A parameter can't modulate itself: the param this cable reads is not
    // a target, and releasing over it leaves the cable where it was.
    const start = settings.get('modGraph');
    const selfKey = paramOutKeyOf(start, start?.bindings.find((b) => b.id === bindingId)?.sourceNodeId ?? '');
    const targets = new Map([...paramJacks].filter(([k]) => k !== selfKey));
    let overSelf = false;
    runGesture(ev, grabbedJack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(jackCenters(targets), pos, SNAP_PX);
        const selfJack = selfKey ? paramJacks.get(selfKey) : undefined;
        overSelf = !hit && !!selfJack && !!nearestJack(jackCenters(new Map([[selfKey!, selfJack]])), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) {
          if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
          p.hover = hit?.id ?? null;
          if (p.hover) paramJacks.get(p.hover)?.classList.add('rw-rack-jack--hover');
        }
      },
      () => {
        if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
        pending = null;
        if (overSelf) return;
        const patch = settings.get('modGraph');
        const binding = patch?.bindings.find((b) => b.id === bindingId);
        const next = p.hover ?? 'none';
        if (patch && binding && binding.paramKey !== next) commitGraph(applyGraphBindingTarget(patch, bindingId, next));
      });
  }

  /** Drag a param's OUTPUT jack onto another param's input: param → param. */
  function beginParamOutDrag(ev: PointerEvent, paramKey: string, grabbedJack: HTMLElement): void {
    const p: Pending = { kind: 'pout-to-param', paramKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, grabbedJack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(jackCenters(paramJacks).filter((c) => c.id !== paramKey), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) {
          if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
          p.hover = hit?.id ?? null;
          if (p.hover) paramJacks.get(p.hover)?.classList.add('rw-rack-jack--hover');
        }
      },
      () => {
        if (p.hover) paramJacks.get(p.hover)?.classList.remove('rw-rack-jack--hover');
        pending = null;
        if (p.hover) commitGraph(bindParamOut(settings.get('modGraph'), paramKey, p.hover));
      });
  }

  /** The graph's two-write rule: Settings for persistence/UI, and the
   *  engine for the live patch. Also switches a Classic-only session to
   *  'both' so the new cable actually does something (the engine no-ops
   *  in 'classic' — same guard every Patch Bay gesture applies). */
  function commitGraph(updated: GraphPatch): void {
    if (updated === settings.get('modGraph')) return;
    if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
    settings.set('modGraph', updated);
    void getEngine?.().then((e) => e.setPatch(updated));
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
    const host = cableHost();
    if (canvas.ownerDocument !== panelRoot.ownerDocument || canvas.parentElement !== host) {
      canvas.remove();
      canvas = panelRoot.ownerDocument.createElement('canvas');
      canvas.className = 'rw-rack-cables';
      ctx = canvas.getContext('2d');
      host.appendChild(canvas);
      if (!ctx) return;
    }

    // Coverage = the host's width x the CONTENT's height, measured from the
    // canvas's own top to the bottom of the deepest non-canvas child —
    // never from the host's scrollHeight, which includes the canvas itself
    // (fitCableCanvas's feedback-loop rule). The canvas's top-left is the
    // drawing origin, and it moves with the scroll, so `local` is exact.
    const origin = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    let bottom = origin.top;
    for (const child of Array.from(host.children)) {
      if (child === canvas || child.classList.contains('rw-pb-scrollbar')) continue;
      const r = child.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    const { w, h } = fitCableCanvas(canvas, ctx, {
      width: hostRect.width,
      height: Math.max(hostRect.height, bottom - origin.top),
    });
    ctx.clearRect(0, 0, w, h);

    const local = (p: Pt): Pt => ({ x: p.x - origin.left, y: p.y - origin.top });
    const plugged = new Set<string>();

    // Classic cables (+ the one being dragged, which follows the pointer).
    const slots = settings.get('modSlots');
    for (const c of classicCables(slots)) {
      if (pending?.kind === 'to-param' && pending.slotIndex === c.slotIndex) continue;
      const jack = paramJacks.get(c.target);
      const outJack = slotJacks.get(c.slotIndex);
      if (!jack || !outJack || !drawable(outJack, jack)) continue;
      const a = anchorFor(outJack);
      const b = anchorFor(jack);
      if (!a || !b) continue;
      plugged.add(c.target);
      drawPatchCable(ctx, local(a), local(b), CLASSIC_COLOR, {
        style: 'sag', dim: !c.enabled, dashed: !reduceMotion && c.enabled, dashOffset,
      });
    }

    // Graph binding cables. A binding fed by a `param-out` node starts at
    // that param's OUTPUT jack (a param → param patch); any other graph
    // source starts at the Modulation section's header.
    const graph = settings.get('modGraph');
    const pluggedOut = new Set<string>();
    /** Where a graph binding's source end is drawn. */
    const graphSrcAnchor = (sourceNodeId: string): Pt | null => {
      const fromKey = paramOutKeyOf(graph, sourceNodeId);
      const outJack = fromKey ? paramOutJacks.get(fromKey) : undefined;
      return outJack ? anchorFor(outJack) : graphSourceAnchor();
    };
    for (const g of graphCables(graph)) {
      if (g.paramKey === 'none') continue;
      if (pending?.kind === 'graph-to-param' && pending.bindingId === g.bindingId) continue;
      const jack = paramJacks.get(g.paramKey);
      if (!jack) continue;
      // Source end: the feeding param's OUT jack, or (other graph nodes)
      // the Modulation header — treat that as hidden when the Modulation
      // section's slot cards aren't on screen.
      const fromKey0 = paramOutKeyOf(graph, g.sourceNodeId);
      const srcJack = fromKey0 ? paramOutJacks.get(fromKey0)
        : panelRoot.querySelector<HTMLElement>('.rw-mod-slot[data-mod-slot]') ?? undefined;
      if (!drawable(srcJack, jack)) continue;
      const a = graphSrcAnchor(g.sourceNodeId);
      const b = anchorFor(jack);
      if (!a || !b) continue;
      plugged.add(g.paramKey);
      const fromKey = paramOutKeyOf(graph, g.sourceNodeId);
      if (fromKey) pluggedOut.add(fromKey);
      drawPatchCable(ctx, local(a), local(b), GRAPH_COLOR, {
        style: 'sag', dim: !g.enabled, dashed: false,
      });
    }

    // Pending (dragged) cable, highlighted, loose end on the pointer.
    if (pending) {
      let a: Pt | null = null;
      let color = CLASSIC_COLOR;
      if (pending.kind === 'to-param') {
        const j = slotJacks.get(pending.slotIndex); a = j ? anchorFor(j) : null;
      } else if (pending.kind === 'to-slot') {
        const j = paramJacks.get(pending.paramKey); a = j ? anchorFor(j) : null;
        if (pending.hover?.kind === 'pout') color = GRAPH_COLOR;
      } else if (pending.kind === 'pout-to-param') {
        const j = paramOutJacks.get(pending.paramKey); a = j ? anchorFor(j) : null;
        color = GRAPH_COLOR;
      } else {
        const id = pending.bindingId;
        const b = graph?.bindings.find((x) => x.id === id);
        a = b ? graphSrcAnchor(b.sourceNodeId) : null;
        color = GRAPH_COLOR;
      }
      const accepting = pending.hover != null;
      panelRoot.classList.toggle('rw-rack-cursor-accept', accepting);
      panelRoot.classList.toggle('rw-rack-cursor-reject', !accepting);
      if (a) {
        drawPatchCable(ctx, local(a), local(pending.pos), color, {
          style: 'sag', highlight: true, dashed: !reduceMotion, dashOffset,
          gradientEnd: accepting ? CABLE_ACCEPT_COLOR : CABLE_REJECT_COLOR,
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
    for (const [key, el] of paramOutJacks) {
      el.classList.toggle('rw-rack-jack--plugged', pluggedOut.has(key));
    }
  }

  // ------------------------------------------------------------------
  // Activation
  // ------------------------------------------------------------------

  /** The cable canvas lives INSIDE the panel's scrolling body, sized to
   *  its content, so it scrolls with the jacks on the compositor (no
   *  one-frame lag behind a scroll) and is clipped by the scroller (cables
   *  never paint over the title, search or tabs) — owner report. Falls
   *  back to the panel root if a body isn't there (e.g. compact layout). */
  function cableHost(): HTMLElement {
    return panelRoot.querySelector<HTMLElement>(':scope .rw-panel-body') ?? panelRoot;
  }

  function activate(): void {
    if (active) return;
    active = true;
    const doc = panelRoot.ownerDocument;
    canvas = doc.createElement('canvas');
    canvas.className = 'rw-rack-cables';
    ctx = canvas.getContext('2d');
    cableHost().appendChild(canvas);
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
      for (const el of paramOutJacks.values()) el.remove();
      paramJacks.clear();
      slotJacks.clear();
      paramOutJacks.clear();
    },
  };
}
