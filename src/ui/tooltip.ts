/**
 * Delayed hover tooltip — a small CRT-styled popover that appears above
 * an element after a hover pause and disappears the instant the pointer
 * leaves. Used to teach the panel: every modulatable slider row and
 * every section header carries one, sourced from `PARAM_DOCS` /
 * `SECTION_HINTS` (the same maps that drive the in-app Help and the
 * About page's Param Reference) so descriptions never drift between
 * surfaces.
 *
 * Popout-safe: the tooltip element lives in the HOVERED element's OWN
 * document (`el.ownerDocument`), not the module-scope `document` — the
 * control panel can live in the two-screen popout window.
 */

const SHOW_DELAY_MS = 550;

/** One shared tooltip element per document (main window + popout each get their own). */
const tooltipsByDoc = new WeakMap<Document, HTMLElement>();

function tooltipFor(doc: Document): HTMLElement {
  const existing = tooltipsByDoc.get(doc);
  if (existing && existing.isConnected) return existing;
  const el = doc.createElement('div');
  el.className = 'rw-hover-tip';
  el.hidden = true;
  doc.body.appendChild(el);
  tooltipsByDoc.set(doc, el);
  return el;
}

/** Position above the target, centered, flipping below if there's no room. */
function position(tip: HTMLElement, target: HTMLElement): void {
  const win = target.ownerDocument.defaultView ?? window;
  const r = target.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(4, Math.min(win.innerWidth - tr.width - 4, left));
  let top = r.top - tr.height - 8;
  if (top < 4) top = r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** Position above a raw point (cursor-following variant), same
 *  clamping/flip rules as the element-anchored `position()` above. */
function positionAtPoint(tip: HTMLElement, doc: Document, x: number, y: number): void {
  const win = doc.defaultView ?? window;
  const tr = tip.getBoundingClientRect();
  let left = x - tr.width / 2;
  left = Math.max(4, Math.min(win.innerWidth - tr.width - 4, left));
  let top = y - tr.height - 14;
  if (top < 4) top = y + 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** Per-document pending schedule timer for `scheduleTooltip`/`cancelTooltip`
 *  — separate from `attachTooltip`'s own per-element closures, since a
 *  drag-time tooltip is driven programmatically (candidate changes during
 *  an active gesture), not by native pointerenter/leave on one element. */
const dragTooltipTimers = new WeakMap<Document, { timer: number | null }>();

function dragTooltipState(doc: Document): { timer: number | null } {
  let s = dragTooltipTimers.get(doc);
  if (!s) { s = { timer: null }; dragTooltipTimers.set(doc, s); }
  return s;
}

/**
 * Schedule a drag-time tooltip near `anchor` (a live point, e.g. the
 * current pointer position, or an element to anchor above) after the
 * same delay as `attachTooltip`. Call again with a new anchor/text to
 * reset the timer (e.g. the drag's snap candidate changed) — this is
 * the intended "restart on change" usage, not a one-shot schedule.
 */
export function scheduleTooltip(
  doc: Document,
  text: string | (() => string | null | undefined),
  anchor: { x: number; y: number } | HTMLElement,
  delayMs: number = SHOW_DELAY_MS,
): void {
  const s = dragTooltipState(doc);
  if (s.timer != null) { clearTimeout(s.timer); s.timer = null; }
  s.timer = window.setTimeout(() => {
    s.timer = null;
    const content = typeof text === 'function' ? text() : text;
    if (!content) return;
    const tip = tooltipFor(doc);
    tip.textContent = content;
    tip.hidden = false;
    if (anchor instanceof HTMLElement) position(tip, anchor);
    else positionAtPoint(tip, doc, anchor.x, anchor.y);
  }, delayMs);
}

/**
 * Show a short hint on `el` right away (no hover delay), e.g. when a
 * press can't start the gesture the user tried. Hides after `holdMs` or
 * when the pointer leaves `el`, whichever comes first.
 */
export function flashTooltip(el: HTMLElement, text: string, holdMs = 2400): void {
  const doc = el.ownerDocument;
  scheduleTooltip(doc, text, el, 0);
  const done = (): void => {
    el.removeEventListener('pointerleave', done);
    window.clearTimeout(t);
    cancelTooltip(doc);
  };
  const t = window.setTimeout(done, holdMs);
  el.addEventListener('pointerleave', done);
  el.classList.add('rw-rack-jack--hint');
  window.setTimeout(() => el.classList.remove('rw-rack-jack--hint'), 700);
}

/** Cancel any pending/shown drag-time tooltip for `doc`. Safe to call
 *  unconditionally (e.g. on every drag-drop, whether or not one was
 *  ever scheduled). */
export function cancelTooltip(doc: Document): void {
  const s = dragTooltipTimers.get(doc);
  if (s?.timer != null) { clearTimeout(s.timer); s.timer = null; }
  const tip = tooltipsByDoc.get(doc);
  if (tip) tip.hidden = true;
}

/**
 * Attach a delayed hover tooltip to `el`. `text` may be a plain string
 * or a lazy function (evaluated on each show) for callers whose copy
 * depends on live state; a falsy result from the function suppresses
 * that show.
 */
export function attachTooltip(el: HTMLElement, text: string | (() => string | null | undefined)): void {
  let timer: number | null = null;
  const cancel = (): void => {
    if (timer != null) { clearTimeout(timer); timer = null; }
  };
  const hide = (): void => {
    cancel();
    const tip = tooltipsByDoc.get(el.ownerDocument);
    if (tip) tip.hidden = true;
  };
  el.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType !== 'mouse') return; // touch has no hover state to speak of
    cancel();
    timer = window.setTimeout(() => {
      timer = null;
      // A cable drag owns the tooltip (drag-time accept/refusal hints —
      // scheduleTooltip); a jack's idle hint must not overwrite it.
      if (el.closest('.rw-rack-dragging')) return;
      const content = typeof text === 'function' ? text() : text;
      if (!content) return;
      const tip = tooltipFor(el.ownerDocument);
      tip.textContent = content;
      tip.hidden = false;
      position(tip, el);
    }, SHOW_DELAY_MS);
  });
  el.addEventListener('pointerleave', () => {
    // During a cable drag the shared tooltip belongs to the drag's own
    // accept/refusal hint — leaving the grabbed jack must not hide it.
    if (el.closest('.rw-rack-dragging')) { cancel(); return; }
    hide();
  });
  // Don't let a tooltip linger through a drag or click.
  el.addEventListener('pointerdown', hide);
}
