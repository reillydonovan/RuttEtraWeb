/**
 * Drag-to-change for every number field (owner ask: "click and drag up or down on a float value
 * … similar to the Unity float drag"). One delegated listener per document — installed from
 * applyThemeToDocument, so popouts get it too — instead of wiring each field.
 *
 * A plain click still focuses the field for typing; a drag past a few pixels takes over: up or
 * right = more, down or left = less, Shift = fine (x0.1), Alt = coarse (x10). Each move fires
 * `input` (what the fields already listen to) and release fires one `change`. The value is
 * clamped to the field's min/max and rounded to its step.
 *
 * Skipped: touch (a drag there scrolls the page), read-only/disabled fields, `[data-no-scrub]`,
 * and `.rw-num-scrubbable` fields, which have their own scrub (attachNumberDragScrub).
 */

import { scrubDelta, roundToStep } from './numberScrubModel';

const THRESHOLD = 4;
const installed = new WeakSet<Document>();

export function installNumberScrub(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  doc.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
    const t = ev.target as Element | null;
    if (!t || (t as HTMLElement).tagName !== 'INPUT') return;
    const input = t as HTMLInputElement;
    if (input.type !== 'number' || input.readOnly || input.disabled) return;
    if (input.classList.contains('rw-num-scrubbable') || input.closest('[data-no-scrub]')) return;
    // Already typing in it: leave the click to place the caret / select text.
    if (doc.activeElement === input) return;

    const startX = ev.clientX, startY = ev.clientY;
    const startVal = parseFloat(input.value);
    const base = Number.isFinite(startVal) ? startVal : 0;
    const min = parseFloat(input.min), max = parseFloat(input.max);
    const step = parseFloat(input.step);
    let dragging = false;

    const onMove = (e: PointerEvent): void => {
      const px = (e.clientX - startX) + (startY - e.clientY);
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) return;
        dragging = true;
        input.blur();
        doc.body.classList.add('rw-num-scrubbing');
        try { input.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      }
      e.preventDefault();
      const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      let next = base + scrubDelta(px, { value: base, min, max, step }) * mult;
      if (Number.isFinite(min)) next = Math.max(min, next);
      if (Number.isFinite(max)) next = Math.min(max, next);
      next = roundToStep(next, step);
      const s = String(next);
      if (input.value === s) return;
      input.value = s;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const onUp = (): void => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
      doc.body.classList.remove('rw-num-scrubbing');
      if (dragging) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  });
}
