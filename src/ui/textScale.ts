/**
 * Global UI text-size preference — a legibility aid, not patch data
 * (same reasoning as `skin.ts`: presentation, not something a project
 * file should snapshot), so it lives in localStorage. Applied via the
 * `--rw-text-scale` custom property consumed by a CSS `zoom` rule
 * scoped to the UI chrome (menu bar + workspace windows), which scales
 * every descendant's fonts AND control sizing together without having
 * to touch each of the many hardcoded font-size declarations across
 * panel.css/timeline.css/rack.css/patchbay.css/workspace.css. The
 * render canvas (`#stage`) is deliberately excluded from the selector
 * so the 3D output's pixel size never changes with this setting.
 */

const STORAGE_KEY = 'rw-ui-text-scale';
export const TEXT_SCALE_DEFAULT = 1;
export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 1.6;
export const TEXT_SCALE_STEP = 0.1;

type Listener = (scale: number) => void;
const listeners = new Set<Listener>();

function clamp(v: number): number {
  const c = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, v));
  return Math.round(c * 100) / 100;
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(v) ? clamp(v) : TEXT_SCALE_DEFAULT;
  } catch {
    return TEXT_SCALE_DEFAULT;
  }
}

let current = readStored();

export function getTextScale(): number {
  return current;
}

export function setTextScale(v: number): void {
  const next = clamp(v);
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, String(current)); } catch { /* private mode */ }
  for (const l of listeners) l(current);
}

export function increaseTextScale(): void { setTextScale(current + TEXT_SCALE_STEP); }
export function decreaseTextScale(): void { setTextScale(current - TEXT_SCALE_STEP); }
export function resetTextScale(): void { setTextScale(TEXT_SCALE_DEFAULT); }

export function subscribeTextScale(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Publishes the current scale to `doc` and keeps it live; returns an
 *  unsubscribe (used when a popout window closes). */
export function applyTextScaleToDocument(doc: Document): () => void {
  const set = (v: number): void => {
    doc.documentElement.style.setProperty('--rw-text-scale', String(v));
  };
  set(current);
  return subscribeTextScale(set);
}

// The main document is always kept in sync, same guarded pattern as
// skin.ts (importing this module from a pure-node test context must
// not explode).
if (typeof document !== 'undefined') applyTextScaleToDocument(document);
