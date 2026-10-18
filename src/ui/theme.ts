/**
 * UI theme preference — 'phosphor' (the original green-on-black CRT look,
 * still one click away) or 'modern' (the default since 2026-10-15, owner's call; neutral Apple-style greys, system sans,
 * rounded glass surfaces and a pointer-following glow; see
 * theme-modern.css).
 *
 * Same shape and reasoning as skin.ts: a LOCAL preference (localStorage
 * `rw-ui-theme`), NOT a Settings key — loading someone's patch must never
 * restyle your panel — so there is no schema bump. A theme is independent
 * of the skin (CRT / HW / RACK): it recolours and reshapes the same faces.
 *
 * The theme is stamped as `body[data-theme="modern"]`; Phosphor removes
 * the attribute entirely, so deleting theme-modern.css (or picking
 * Phosphor) restores today's look exactly.
 */

import './theme-modern.css';
import { attachGlow } from './themeGlow';

import { installSelectMenus } from './dropdown';
import { installNumberScrub } from './numberScrub';

export type ThemeId = 'phosphor' | 'modern';

const STORAGE_KEY = 'rw-ui-theme';
const VALID: readonly ThemeId[] = ['phosphor', 'modern'];

type Listener = (theme: ThemeId) => void;
const listeners = new Set<Listener>();

/** Documents whose `<body data-theme>` we keep stamped (main + popouts). */
const stampedDocs = new Set<Document>();
/** Pointer-glow detach functions, present only while the theme is modern. */
const glowDetach = new Map<Document, () => void>();

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return v && VALID.includes(v) ? v : 'modern';
  } catch {
    return 'modern';
  }
}

let current: ThemeId = readStored();

export function getTheme(): ThemeId {
  return current;
}

export function setTheme(theme: ThemeId): void {
  if (!VALID.includes(theme) || theme === current) return;
  current = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode etc. */ }
  for (const doc of stampedDocs) stamp(doc);
  for (const fn of listeners) fn(theme);
}

/** Fires immediately with the current theme, then on every change. */
export function subscribeTheme(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}

/** Keep `doc.body.dataset.theme` in sync until `releaseThemeDocument(doc)`. */
export function applyThemeToDocument(doc: Document): void {
  stampedDocs.add(doc);
  stamp(doc);
  installSelectMenus(doc);   // themed dropdown panels in this window (main or a popout)
  installNumberScrub(doc);   // drag any number field up/down to change it
}

export function releaseThemeDocument(doc: Document): void {
  stampedDocs.delete(doc);
  glowDetach.get(doc)?.();
  glowDetach.delete(doc);
}

function stamp(doc: Document): void {
  if (!doc.body) return;
  // The glow listener only exists while Modern is active.
  if (current === 'modern' && !glowDetach.has(doc)) glowDetach.set(doc, attachGlow(doc));
  else if (current !== 'modern') { glowDetach.get(doc)?.(); glowDetach.delete(doc); }
  // <html> is stamped too so the token block (`:root[data-theme]`) can
  // restate the --re-* colours for the root background as well.
  if (current === 'phosphor') {
    delete doc.body.dataset.theme;
    delete doc.documentElement.dataset.theme;
  } else {
    doc.body.dataset.theme = current;
    doc.documentElement.dataset.theme = current;
  }
}

if (typeof document !== 'undefined') applyThemeToDocument(document);
