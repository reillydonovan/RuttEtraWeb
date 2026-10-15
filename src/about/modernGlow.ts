/**
 * Pointer glow for the static pages in the Modern theme (a few-lines copy
 * of src/ui/themeGlow.ts — deliberately NOT imported, that module's
 * folder pulls in synth widgets). Inert unless html[data-theme="modern"],
 * a hover-capable device, and no reduced-motion preference.
 */
const CARDS = '.about-node, #about-doc pre, #about-doc blockquote, #tut-outline';

export function attachModernGlow(): void {
  if (document.documentElement.dataset.theme !== 'modern') return;
  if (!matchMedia('(hover: hover)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let queued = false;
  let ev: PointerEvent | null = null;
  document.addEventListener('pointermove', (e) => {
    ev = e;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const el = (ev?.target as Element | null)?.closest?.(CARDS) as HTMLElement | null;
      if (!el || !ev) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(ev.clientX - r.left).toFixed(0)}px`);
      el.style.setProperty('--my', `${(ev.clientY - r.top).toFixed(0)}px`);
    });
  }, { passive: true });
}
