/**
 * UI skin preference — 'standard' (flat CRT) or 'hardware' (skeuomorphic
 * euro-panel: rotary knobs, bat switches, LCD strips).
 *
 * Deliberately a LOCAL preference (localStorage), NOT a Settings key:
 * Settings keys ride into presets, `.synth.json` projects, and auto-save
 * payloads, and loading someone else's patch must never restyle your
 * panel. See docs/design/skeuomorphic-skin.md §1 for the full reasoning
 * (including why the `panelCollapsed`/`timelineDock` precedent doesn't
 * apply).
 *
 * A skin is a FACE, not a fork: it renders inside the existing widget
 * functions, selected purely by CSS off `body[data-skin]` — the same
 * mechanism `body[data-layout]` uses (ResponsivePanel). Skin faces write
 * base values through the same widget write paths as the standard skin
 * and read LiveValuesStore for display only (base/live split,
 * principle 2).
 */

import './skin.css';

/**
 * 'standard'  — flat CRT (the original theme).
 * 'hardware'  — skeuomorphic faces: knobs, bat switches, LCD strips.
 * 'rack'      — hardware faces PLUS rack-module chrome and a live
 *               patch-cable layer (src/ui/rack/). CSS that targets the
 *               hardware faces matches both via
 *               `body:is([data-skin="hardware"], [data-skin="rack"])`.
 */
export type SkinId = 'standard' | 'hardware' | 'rack';

const STORAGE_KEY = 'rw-ui-skin';
const VALID: readonly SkinId[] = ['standard', 'hardware', 'rack'];

type Listener = (skin: SkinId) => void;
const listeners = new Set<Listener>();

/**
 * Every document whose `<body data-skin>` we keep stamped — the main
 * window, plus the panel popout's document while it is open
 * (PanelPopout registers/releases it).
 */
const stampedDocs = new Set<Document>();

function readStored(): SkinId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as SkinId | null;
    return v && VALID.includes(v) ? v : 'standard';
  } catch {
    return 'standard';
  }
}

let current: SkinId = readStored();

export function getSkin(): SkinId {
  return current;
}

export function setSkin(skin: SkinId): void {
  if (skin === current) return;
  current = skin;
  try { localStorage.setItem(STORAGE_KEY, skin); } catch { /* private mode etc. */ }
  for (const doc of stampedDocs) stamp(doc);
  for (const fn of listeners) fn(skin);
}

/** Cycle standard → hardware → rack → standard. */
export function toggleSkin(): SkinId {
  setSkin(VALID[(VALID.indexOf(current) + 1) % VALID.length]);
  return current;
}

/** Fires immediately with the current skin, then on every change. */
export function subscribeSkin(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

/**
 * Keep `doc.body.dataset.skin` in sync until `releaseDocument(doc)`.
 * PanelPopout calls this for the popup window's document (which gets a
 * fresh <body> the main-document stamp can't reach).
 */
export function applySkinToDocument(doc: Document): void {
  stampedDocs.add(doc);
  stamp(doc);
}

export function releaseDocument(doc: Document): void {
  stampedDocs.delete(doc);
}

function stamp(doc: Document): void {
  if (!doc.body) return;
  if (current === 'standard') delete doc.body.dataset.skin;
  else doc.body.dataset.skin = current;
}

// The main document is always stamped. Guarded so importing this module
// from a pure-node context (tests of modules that transitively import
// widgets) doesn't explode — same pattern as ModMatrix's window guard.
if (typeof document !== 'undefined') applySkinToDocument(document);
