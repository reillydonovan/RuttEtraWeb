/**
 * Motion — second-order (spring) animation for every expand / collapse.
 *
 * A second-order system has position AND velocity, so a thing that opens
 * accelerates out of rest, arrives with the velocity it built up and (when
 * under-damped) settles past its target by a hair, instead of easing along a
 * fixed curve. It also stays continuous if you reverse it mid-flight: the
 * velocity carries over. That is what guides the eye: motion that has mass.
 *
 * Two springs drive a toggle, both integrated here (no CSS curve):
 *   - HEIGHT is critically damped (zeta 1): fast, never overshoots, because a
 *     container that grows past its content would show empty space.
 *   - the CARET and the content's fade are under-damped (zeta ~0.55): the caret
 *     swings through its angle and settles, the content arrives a beat later.
 *
 * Reduced motion: the toggle just happens.
 */

export interface SpringCfg {
  /** Natural frequency, rad/s. Higher = faster. */
  omega: number;
  /** Damping ratio. 1 = critical (no overshoot), <1 = rings, >1 = sluggish. */
  zeta: number;
}

export const HEIGHT_SPRING: SpringCfg = { omega: 26, zeta: 1 };
export const SETTLE_SPRING: SpringCfg = { omega: 22, zeta: 0.55 };

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Spring { x: number; v: number; target: number; cfg: SpringCfg }

/** Semi-implicit Euler on x'' = -omega^2 (x - target) - 2 zeta omega x'. Sub-stepped for stability. */
function step(s: Spring, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  const { omega, zeta } = s.cfg;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.target) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
const settled = (s: Spring, eps: number): boolean => Math.abs(s.x - s.target) < eps && Math.abs(s.v) < eps * 8;

const running = new WeakMap<HTMLElement, { cancel: () => void; heightV: number; h: number }>();

/**
 * Animate a container between two layout states.
 *
 * `mutate` flips the state (toggles a class) and `undo` flips it back (a
 * shrinking container keeps its content on screen while it shrinks, then
 * `mutate` is applied for real at the end); this measures the container's
 * height before and after it, then springs the height from one to the other
 * with the content clipped meanwhile. `caret` (optional) is a custom property
 * name set on the container each frame with the caret's angle in degrees, and
 * `fromDeg`/`toDeg` its two resting angles. A second toggle during the flight
 * starts from the current height AND velocity.
 */
export function animateToggle(
  host: HTMLElement,
  mutate: () => void,
  undo: () => void,
  opts: { caret?: string; fromDeg?: number; toDeg?: number; onDone?: () => void; width?: boolean } = {},
): void {
  const prev = running.get(host);
  const liveH = host.offsetHeight;
  const carryV = prev ? prev.heightV : 0;
  prev?.cancel();

  const startH = liveH;
  const startW = host.offsetWidth;
  host.style.height = '';
  host.style.overflow = '';
  mutate();
  const endH = host.offsetHeight;
  const endW = host.offsetWidth;
  const endWidthStyle = host.style.width;   // what the new state wants once the motion is over

  if (reduced() || Math.abs(endH - startH) < 2 || !host.isConnected) {
    opts.onDone?.();
    return;
  }
  const shrinking = endH < startH;
  if (shrinking) undo();   // content stays visible while the box closes around it

  host.style.overflow = 'hidden';
  host.style.height = `${startH}px`;
  host.classList.add('rw-animating');
  const hs: Spring = { x: startH, v: carryV, target: endH, cfg: HEIGHT_SPRING };
  // Width (opt-in): the same critically damped spring, so a node narrows as it closes.
  const doW = !!opts.width && Math.abs(endW - startW) > 2;
  const ws: Spring = { x: startW, v: 0, target: endW, cfg: HEIGHT_SPRING };
  if (doW) host.style.width = `${startW}px`;
  // Content fade / settle: 0 → 1 when growing, 1 → 0 when shrinking.
  const growing = endH > startH;
  const fs: Spring = { x: growing ? 0 : 1, v: 0, target: growing ? 1 : 0, cfg: SETTLE_SPRING };
  const hasCaret = !!opts.caret && opts.fromDeg !== undefined && opts.toDeg !== undefined;
  const cs: Spring = { x: opts.fromDeg ?? 0, v: 0, target: opts.toDeg ?? 0, cfg: SETTLE_SPRING };
  if (hasCaret) host.style.setProperty(opts.caret!, `${cs.x}deg`);

  let raf = 0;
  let last = performance.now();
  let alive = true;
  const entry = { cancel: () => { alive = false; cancelAnimationFrame(raf); host.classList.remove('rw-animating'); }, heightV: carryV, h: startH };
  running.set(host, entry);

  const finish = (): void => {
    alive = false;
    if (shrinking) mutate();
    if (doW) host.style.width = endWidthStyle;
    host.style.height = '';
    host.style.overflow = '';
    host.style.removeProperty('--rw-mo-fade');
    if (hasCaret) host.style.removeProperty(opts.caret!);
    host.classList.remove('rw-animating');
    running.delete(host);
    opts.onDone?.();
  };

  const tick = (now: number): void => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(hs, dt); step(fs, dt);
    if (doW) { step(ws, dt); host.style.width = `${Math.max(0, ws.x)}px`; }
    if (hasCaret) step(cs, dt);
    entry.heightV = hs.v;
    host.style.height = `${Math.max(0, hs.x)}px`;
    host.style.setProperty('--rw-mo-fade', String(Math.min(1, Math.max(0, fs.x))));
    if (hasCaret) host.style.setProperty(opts.caret!, `${cs.x}deg`);
    if (settled(hs, 0.4) && settled(fs, 0.01) && (!hasCaret || settled(cs, 0.2)) && (!doW || settled(ws, 0.4))) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
