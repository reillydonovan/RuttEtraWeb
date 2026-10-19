/**
 * determinism — the two things offline rendering has to control: time and chance.
 *
 * Live mode never calls `useOfflineDeterminism`, so `nowMs()` IS `performance.now()` and
 * `random()` IS `Math.random()`: byte-for-byte the old behaviour. Offline render mode
 * (`?render=offline`, src/render/offline.ts) swaps both: time becomes `frame / fps` and
 * chance becomes a seeded PRNG, so the same job renders the same pixels every time.
 *
 * Only code whose result reaches the picture or the modulation reads these. IDs, UI
 * timers and diagnostics keep using `performance.now()` / `Math.random()` directly.
 */

let nowImpl: () => number = () => performance.now();
let randomImpl: () => number = Math.random;

/** Milliseconds, like `performance.now()`. Offline: the render clock. */
export function nowMs(): number {
  return nowImpl();
}

/** 0 <= x < 1, like `Math.random()`. Offline: seeded. */
export function random(): number {
  return randomImpl();
}

/** mulberry32: small, fast, and identical in every JS engine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Offline render only. `clockMs` must return the current render time in ms. */
export function useOfflineDeterminism(clockMs: () => number, seed: number): void {
  nowImpl = clockMs;
  randomImpl = seededRandom(seed);
}
