/**
 * User graph-patch library — named, saved copies of `GraphPatch` that the
 * user can load, overwrite, and delete from the Graph-view sidebar.
 * Complements the read-only `STARTER_PATCHES` templates (coexistence, not
 * replacement).
 *
 * Persistence: localStorage under its own key, versioned independently of
 * `Settings._v` (the library is workspace-level state like timelines, not
 * a synth parameter). Projects do NOT embed the library yet — the active
 * patch travels inside `settings.modGraph` as before; embedding the
 * library in `.synth.json` is a documented follow-up (AUDIT item 23).
 *
 * All list operations are pure (return new arrays) so they can be tested
 * without a DOM and so callers can't alias the stored state.
 */

import { GraphPatch } from './types';

export interface UserPatch {
  id: string;
  name: string;
  /** Epoch ms at save time. */
  savedAt: number;
  patch: GraphPatch;
}

export interface UserLibrary {
  _v: 1;
  patches: UserPatch[];
}

export const USER_LIBRARY_KEY = 'ruttetra.graphLibrary.v1';
const MAX_PATCHES = 64;

export function emptyLibrary(): UserLibrary {
  return { _v: 1, patches: [] };
}

/**
 * Parse a serialized library. Malformed input (bad JSON, wrong shape,
 * non-array patches) degrades to an empty library rather than throwing —
 * a corrupt localStorage entry must never brick the Graph panel.
 * Entries missing required fields are dropped individually.
 */
export function parseUserLibrary(json: string | null): UserLibrary {
  if (!json) return emptyLibrary();
  try {
    const raw = JSON.parse(json) as Partial<UserLibrary> | null;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.patches)) return emptyLibrary();
    const patches = raw.patches.filter((p): p is UserPatch =>
      !!p && typeof p === 'object' &&
      typeof (p as UserPatch).id === 'string' &&
      typeof (p as UserPatch).name === 'string' &&
      !!(p as UserPatch).patch &&
      Array.isArray((p as UserPatch).patch.nodes) &&
      Array.isArray((p as UserPatch).patch.bindings),
    );
    return { _v: 1, patches };
  } catch {
    return emptyLibrary();
  }
}

export function serializeUserLibrary(lib: UserLibrary): string {
  return JSON.stringify(lib);
}

/**
 * Add (or overwrite-by-name) a patch. Saving under an existing name
 * replaces that entry in place — matching how users think about "Save as
 * 'My Drone Patch'" — rather than accumulating duplicates. The patch is
 * deep-cloned so later edits to the live graph don't mutate the library.
 * List is capped at MAX_PATCHES (oldest dropped) as a runaway guard.
 */
export function savePatch(
  lib: UserLibrary,
  name: string,
  patch: GraphPatch,
  now: number,
): UserLibrary {
  const trimmed = name.trim();
  if (!trimmed) return lib;
  const clone: GraphPatch = JSON.parse(JSON.stringify(patch)) as GraphPatch;
  const existing = lib.patches.find((p) => p.name === trimmed);
  const entry: UserPatch = {
    id: existing?.id ?? `up-${now.toString(36)}-${lib.patches.length}`,
    name: trimmed,
    savedAt: now,
    patch: clone,
  };
  const others = lib.patches.filter((p) => p.name !== trimmed);
  const patches = [...others, entry].slice(-MAX_PATCHES);
  return { _v: 1, patches };
}

export function deletePatch(lib: UserLibrary, id: string): UserLibrary {
  return { _v: 1, patches: lib.patches.filter((p) => p.id !== id) };
}

// ------------------------- localStorage wrapper -------------------------

export function loadUserLibrary(storage: Pick<Storage, 'getItem'> = localStorage): UserLibrary {
  try {
    return parseUserLibrary(storage.getItem(USER_LIBRARY_KEY));
  } catch {
    // storage access itself can throw (privacy mode) — degrade gracefully.
    return emptyLibrary();
  }
}

export function storeUserLibrary(
  lib: UserLibrary,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(USER_LIBRARY_KEY, serializeUserLibrary(lib));
  } catch {
    // Quota / privacy failures are non-fatal; the in-memory list stands.
  }
}
