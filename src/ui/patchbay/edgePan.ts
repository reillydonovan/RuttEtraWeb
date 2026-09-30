/**
 * Edge auto-pan motion model for the Patch Bay (pure, DOM-free).
 *
 * Owner ask: dragging a cable or module to the edge of a zoomed-in bay
 * should move the view so you can see where you're dropping — "smooth
 * and natural, so it doesn't stutter." One axis at a time:
 *
 *   • `edgePull` maps the pointer's depth into an edge band (or past the
 *     edge) to a signed −1.4..1.4 through a smoothstep, so motion starts
 *     gently rather than at full speed the moment the band is entered;
 *   • `stepAxis` eases the actual velocity toward that target with an
 *     exponential time constant, so speeding up, slowing down, leaving
 *     the band and releasing (a short glide) are all continuous;
 *   • near the end of the scrollable range the speed is capped in
 *     proportion to the distance left, so the view eases to a stop at
 *     the limit instead of slamming into it.
 *
 * PatchBayView steps both axes once per animation frame, before drawing
 * cables, so the scroll and the redrawn cables land in the same frame.
 */

export const EDGE_PAN = {
  /** Edge band depth in CSS px (capped at 20% of a small view). */
  edge: 56,
  /** CSS px / s at full band depth. */
  maxSpeed: 1400,
  /** Velocity easing time constant, s. */
  tau: 0.12,
  /** Speed cap per px of scroll remaining, 1/s. */
  brake: 7,
  /** Below this speed (px/s) a released glide is considered at rest. */
  restSpeed: 4,
} as const;

/** Signed, eased pull toward the low (−) or high (+) edge of [lo, hi]. */
export function edgePull(p: number, lo: number, hi: number, edge: number = EDGE_PAN.edge): number {
  const band = Math.min(edge, (hi - lo) * 0.2);
  if (!(band > 0)) return 0;
  let d = 0;
  if (p < lo + band) d = -(lo + band - p) / band;
  else if (p > hi - band) d = (p - (hi - band)) / band;
  if (d === 0) return 0;
  const m = Math.min(1, Math.abs(d));
  const over = Math.min(0.4, Math.max(0, Math.abs(d) - 1)); // past the edge: a little faster
  return Math.sign(d) * (m * m * (3 - 2 * m) + over);
}

export interface AxisState {
  /** Current velocity, px/s. */
  v: number;
  /** Fractional scroll position being steered, px. */
  pos: number;
}

/**
 * Advance one axis by `dt` seconds toward `targetV` (px/s), clamped to
 * [0, max]. `calm` (prefers-reduced-motion) skips the velocity easing.
 * Returns the new state; `pos` is what to assign to scrollLeft/Top.
 */
export function stepAxis(s: AxisState, targetV: number, max: number, dt: number, calm = false): AxisState {
  const a = calm ? 1 : 1 - Math.exp(-dt / EDGE_PAN.tau);
  let v = s.v + (targetV - s.v) * a;
  const room = v > 0 ? max - s.pos : s.pos;
  const cap = Math.max(0, room) * EDGE_PAN.brake;
  v = Math.max(-cap, Math.min(cap, v));
  if (targetV === 0 && Math.abs(v) < EDGE_PAN.restSpeed) v = 0;
  const pos = Math.max(0, Math.min(max, s.pos + v * dt));
  return { v, pos };
}
