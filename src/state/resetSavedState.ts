/**
 * `?reset` escape hatch — clears everything this app keeps in localStorage
 * (settings snapshot, user presets, timelines, graph library, auto-save,
 * recent projects, skin, text size, debug flags) so a bad saved state can
 * never lock someone out. Nothing is lost outright: every cleared entry is
 * copied into one `ruttetra-backup` item first (overwriting any previous
 * backup), which can be restored by hand from the browser's dev tools.
 *
 * Pure over a `Storage` so it's unit-testable without a browser.
 */

export const BACKUP_KEY = 'ruttetra-backup';

/** Keys this app owns: `ruttetra.*`, `rw-*` (skin, text size), `RW_*`
 *  (debug flags). The backup key itself is never swept. */
export function isAppStorageKey(key: string): boolean {
  if (key === BACKUP_KEY) return false;
  return key.startsWith('ruttetra.') || key.startsWith('rw-') || key.startsWith('RW_');
}

/** Back up and remove every app-owned key. Returns how many were cleared. */
export function resetSavedState(storage: Storage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k != null && isAppStorageKey(k)) keys.push(k);
  }
  const entries: Record<string, string> = {};
  for (const k of keys) {
    const v = storage.getItem(k);
    if (v != null) entries[k] = v;
  }
  try {
    storage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), entries }));
  } catch {
    // Quota or private mode: still clear — getting the app running again
    // is the point of ?reset.
  }
  for (const k of keys) storage.removeItem(k);
  return keys.length;
}
