/**
 * AutoSave — interval-based "safety-net" snapshot writer.
 *
 * Writes the current project's full snapshot to localStorage every
 * `INTERVAL_MS` while enabled, but ONLY when the project is actually
 * dirty (no point churning the storage if nothing changed). On
 * page boot, if a stored auto-save exists newer than the user's
 * last explicit save, the UI offers to recover.
 *
 * This is a recovery mechanism, not a primary save — it doesn't
 * replace explicit Save to file. Storage limit is browser-imposed
 * (~5MB on most browsers); a single project rarely exceeds 100KB so
 * we don't bother with rotation.
 */

import type { ProjectStore } from './ProjectStore';
import { serializeProject } from './Project';

const AUTOSAVE_KEY = 'ruttetra.project.autosave.v1';
const AUTOSAVE_ENABLED_KEY = 'ruttetra.project.autosave.enabled';
const INTERVAL_MS = 60_000; // 60s — spec.

/** Shape of the persisted blob — adds metadata around the project
 *  body so the recovery UI can describe what's there before the user
 *  decides whether to load it. */
export interface AutoSavePayload {
  writtenAt: string;
  projectName: string;
  json: string;
}

export class AutoSave {
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private store: ProjectStore;

  constructor(store: ProjectStore) {
    this.store = store;
    // Honor the user's prior choice (persisted across sessions).
    if (loadEnabledFlag()) this.start();
  }

  // -------------------- Public API --------------------

  isEnabled(): boolean { return this.enabled; }

  /** Turn on the autosave loop. Idempotent. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    saveEnabledFlag(true);
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
    // First tick immediately so an enable-then-crash sequence still
    // produces a recoverable snapshot.
    this.tick();
  }

  /** Turn off the autosave loop. Existing snapshot stays in
   *  localStorage so the user can still recover from a previous
   *  enable-cycle until they explicitly clear it. */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    saveEnabledFlag(false);
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Write a snapshot now if dirty. Public so the UI can force one
   *  before navigation (we hook `beforeunload` in main.ts). */
  tick(): void {
    if (!this.store.getState().dirty) return;
    const name = this.store.getState().name ?? 'Untitled Project';
    const project = this.store.snapshot(name);
    const payload: AutoSavePayload = {
      writtenAt: new Date().toISOString(),
      projectName: name,
      json: serializeProject(project),
    };
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[autosave] write failed', err);
    }
  }

  /** Read the current pending recovery payload, if any. The UI
   *  surfaces a prompt on boot when this returns non-null. */
  static loadPending(): AutoSavePayload | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AutoSavePayload>;
      if (!parsed.json || !parsed.writtenAt) return null;
      return {
        writtenAt: parsed.writtenAt,
        projectName: parsed.projectName ?? 'Untitled Project',
        json: parsed.json,
      };
    } catch { return null; }
  }

  /** Discard the pending recovery snapshot. Called after the user
   *  declines to recover, or after a successful explicit save. */
  static clearPending(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  }

  /** Format the snapshot's age as a "5 minutes ago" style hint. */
  static formatAge(writtenAtIso: string): string {
    const t = Date.parse(writtenAtIso);
    if (!Number.isFinite(t)) return 'recently';
    const ms = Date.now() - t;
    if (ms < 60_000)         return 'less than a minute ago';
    if (ms < 60 * 60_000)    return `${Math.floor(ms / 60_000)} minute${ms < 120_000 ? '' : 's'} ago`;
    if (ms < 24 * 3_600_000) return `${Math.floor(ms / 3_600_000)} hour${ms < 7_200_000 ? '' : 's'} ago`;
    return `${Math.floor(ms / 86_400_000)} day${ms < 172_800_000 ? '' : 's'} ago`;
  }
}

function loadEnabledFlag(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(AUTOSAVE_ENABLED_KEY) === '1'; } catch { return false; }
}

function saveEnabledFlag(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(AUTOSAVE_ENABLED_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
