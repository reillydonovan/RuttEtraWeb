/**
 * How much bigger an element draws on screen than its own CSS pixels — the
 * Text Size `zoom` on the window shells. Pointer coordinates are screen
 * pixels and bar positions are CSS pixels, so every pointer → layout
 * conversion divides by this (at 110% a timeline click 400px in used to
 * land 40px further right; graph nodes trailed the cursor the same way).
 */
export function screenScale(el: HTMLElement): number {
  const w = el.offsetWidth;
  const r = el.getBoundingClientRect().width;
  return w > 0 && r > 0 ? r / w : 1;
}

/** A pointer's clientX as an x in the element's own CSS pixels. */
export function localX(el: HTMLElement, clientX: number): number {
  return (clientX - el.getBoundingClientRect().left) / screenScale(el);
}

/** A pointer's clientY as a y in the element's own CSS pixels. */
export function localY(el: HTMLElement, clientY: number): number {
  return (clientY - el.getBoundingClientRect().top) / screenScale(el);
}
