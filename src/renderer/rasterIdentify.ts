/**
 * Raster identify tint (v1.29) — a setup aid, never part of the output.
 *
 * With Dual Raster on, the rasters render through one shared color
 * pipeline, so it can be hard to tell which scan lines belong to A, B
 * or C. "Identify rasters" tints them green / cyan / amber on screen
 * while you set up.
 *
 * Two rules keep the tint out of anything that leaves the app:
 *
 *  1. The toggle is deliberately NOT a Settings key: it is never saved,
 *     never in a preset/project/timeline snapshot, and starts OFF on
 *     every load.
 *  2. Every path that takes the render canvas out of the app (recorder,
 *     PeerJS broadcast, WHIP, the render popout, a WebXR session, an MCP
 *     screenshot) registers itself here while active via
 *     `setOutputActive(reason, true)`. While ANY output is active the
 *     EFFECTIVE tint is off, whatever the toggle says. It comes back on
 *     its own when the last output stops: the user's request is
 *     remembered, only the drawing is suppressed.
 *
 * Pure module state + listeners, no DOM/WebGL — unit-tested in node.
 */

let requested = false;
const activeOutputs = new Set<string>();
const effectiveListeners = new Set<(effective: boolean) => void>();
const stateListeners = new Set<() => void>();
let lastEffective = false;

function effectiveNow(): boolean {
  return requested && activeOutputs.size === 0;
}

function changed(): void {
  const eff = effectiveNow();
  if (eff !== lastEffective) {
    lastEffective = eff;
    for (const fn of effectiveListeners) fn(eff);
  }
  for (const fn of stateListeners) fn();
}

/** The user's toggle (what the checkbox shows). */
export function isIdentifyRequested(): boolean {
  return requested;
}

export function setIdentifyRequested(on: boolean): void {
  if (requested === on) return;
  requested = on;
  changed();
}

/** Whether the tint is actually drawn right now (requested AND no output active). */
export function isIdentifyEffective(): boolean {
  return effectiveNow();
}

/** Mark an output path active/inactive. `reason` is a stable id
 *  ('recorder', 'broadcast', 'whip', 'renderPopout', 'xr', …) so
 *  overlapping outputs are tracked independently. */
export function setOutputActive(reason: string, on: boolean): void {
  const had = activeOutputs.has(reason);
  if (on === had) return;
  if (on) activeOutputs.add(reason); else activeOutputs.delete(reason);
  changed();
}

/** Any output currently taking the canvas out of the app? */
export function isAnyOutputActive(): boolean {
  return activeOutputs.size > 0;
}

/** Subscribe to the EFFECTIVE tint (renderer side). Fires immediately. */
export function subscribeIdentify(fn: (effective: boolean) => void): () => void {
  effectiveListeners.add(fn);
  fn(effectiveNow());
  return () => { effectiveListeners.delete(fn); };
}

/** Subscribe to ANY change — request or output activity (UI side: keeps
 *  every checkbox copy and its "paused while…" note in sync). */
export function subscribeIdentifyState(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => { stateListeners.delete(fn); };
}

/** Test-only: reset module state between cases. */
export function __resetRasterIdentifyForTests(): void {
  requested = false;
  activeOutputs.clear();
  effectiveListeners.clear();
  stateListeners.clear();
  lastEffective = false;
}
