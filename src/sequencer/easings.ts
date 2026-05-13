/**
 * Easing curves used by the Sequencer to shape interpolation between
 * keyframes. All take a normalized `t` in [0,1] and return a shaped value
 * in (roughly) [0,1].
 *
 * `step`: jumps to incoming keyframe immediately at t=0.
 * `hold`: stays on outgoing keyframe value until t reaches 1 (then jumps).
 *
 * The Sequencer interprets `step` and `hold` directly when sampling, but the
 * functions here are returned for completeness so UI tooltips can chart them.
 */

import type { EasingType } from './types';

export function easeLinear(t: number): number {
  return t;
}
export function easeIn(t: number): number {
  // cubic ease-in
  return t * t * t;
}
export function easeOut(t: number): number {
  // cubic ease-out
  const u = 1 - t;
  return 1 - u * u * u;
}
export function easeInOut(t: number): number {
  // smoothstep on cubic
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Discrete: returns 1 immediately at t > 0 (jump to incoming). */
export function easeStep(t: number): number {
  return t > 0 ? 1 : 0;
}

/** Discrete: returns 0 until t >= 1 (hold outgoing, then jump). */
export function easeHold(t: number): number {
  return t >= 1 ? 1 : 0;
}

export function applyEasing(easing: EasingType, t: number): number {
  // clamp to [0,1] defensively
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'linear':    return easeLinear(x);
    case 'easeIn':    return easeIn(x);
    case 'easeOut':   return easeOut(x);
    case 'easeInOut': return easeInOut(x);
    case 'step':      return easeStep(x);
    case 'hold':      return easeHold(x);
    default:          return easeLinear(x);
  }
}
