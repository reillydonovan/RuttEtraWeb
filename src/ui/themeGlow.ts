/**
 * Modern-theme pointer glow: while the pointer moves over a surface in
 * GLOW_SELECTOR, publish its position (in the surface's own CSS pixels)
 * as `--mx` / `--my` so theme-modern.css can centre a radial gradient
 * there (ported from nothingbutdatacenters.com's site.js).
 *
 * KEEP GLOW_SELECTOR IN STEP with the GLOW behaviour's selector list in
 * theme-modern.css — to light a new component, add it to both.
 *
 * Cost: one passive pointermove per stamped document, rAF-coalesced, one
 * `closest()` + one `getBoundingClientRect()` per frame. Inert unless the
 * device can hover and the user hasn't asked for reduced motion.
 */

export const GLOW_SELECTOR = [
  '.rw-section', '.rw-pb-module', '.rw-pb-field', '.rw-pb-graphnode', '.rw-pb-bus',
  '.rw-graph-node', '.rw-mod-slot', '.rw-menu', '.rw-info-card', '.rw-numeric-modal-card',
  '.rw-about-dialog-card', '.rw-tut-callout',
].join(', ');

/**
 * Pointer position in the element's own CSS pixels. The element's rect is
 * in visual pixels; under the Text Size `zoom` (and the Patch Bay's board
 * transform-scale) a CSS pixel is not a visual pixel, so divide by the
 * rendered/laid-out width ratio.
 */
export function localPoint(
  clientX: number, clientY: number,
  rect: { left: number; top: number; width: number },
  layoutWidth: number,
): { x: number; y: number } {
  let z = layoutWidth > 0 ? rect.width / layoutWidth : 1;
  if (!(z > 0.1 && z < 10)) z = 1;
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
}

/** Start tracking `doc`; returns the detach function. */
export function attachGlow(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win || typeof win.matchMedia !== 'function') return () => {};
  if (!win.matchMedia('(hover: hover)').matches) return () => {};
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  let queued = false;
  let lx = 0;
  let ly = 0;
  let target: EventTarget | null = null;

  const apply = (): void => {
    queued = false;
    const t = target as Element | null;
    const el = t && typeof t.closest === 'function' ? (t.closest(GLOW_SELECTOR) as HTMLElement | null) : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = localPoint(lx, ly, r, el.offsetWidth);
    el.style.setProperty('--mx', `${p.x.toFixed(0)}px`);
    el.style.setProperty('--my', `${p.y.toFixed(0)}px`);
  };
  const onMove = (e: PointerEvent): void => {
    lx = e.clientX;
    ly = e.clientY;
    target = e.target;
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(apply);
  };
  doc.addEventListener('pointermove', onMove, { passive: true });
  return () => doc.removeEventListener('pointermove', onMove);
}
