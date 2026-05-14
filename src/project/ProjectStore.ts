/**
 * ProjectStore — runtime state for the Project save/load system.
 *
 * Tracks:
 *   - the active project's name (or null if untitled),
 *   - a dirty flag (true if Settings have changed since the last save
 *     or open), driven by `SettingsStore.subscribeAll`,
 *   - the recent-projects list (up to 8 entries, persisted in
 *     localStorage; entries hold a `FileSystemFileHandle` when the
 *     browser supports the FS Access API),
 *   - the last opened/saved `FileSystemFileHandle` (so plain Save
 *     can write back without prompting).
 *
 * Also owns "Save Project / Save As / Open Project / New Project"
 * orchestration — these methods accept the snapshot/apply deps and
 * call out to either the FS Access API or a download/upload fallback
 * depending on browser support.
 *
 * Pure DOM-side; no rendering. The UI subscribes via `subscribe()`
 * to react to state changes (title bar, menu enable/disable, etc.).
 */

import {
  SynthProject, RecentProjectEntry,
} from './types';
import {
  ProjectSnapshotDeps, ProjectApplyDeps, snapshotProject, parseProject,
  serializeProject, applyProject,
} from './Project';
import type { ProjectSummary } from './types';

const RECENT_KEY = 'ruttetra.project.recent.v1';
const MAX_RECENT = 8;

/** Public state surfaced through `subscribe()`. */
export interface ProjectState {
  /** Active project name or null when no project is loaded /
   *  the user is editing the default session. */
  name: string | null;
  /** True iff Settings (or presets / timelines via `markDirty()`)
   *  have changed since the last save / open. */
  dirty: boolean;
  /** Most recently opened/saved files. Newest first. */
  recent: RecentProjectEntry[];
  /** True if the FS Access API is available. UI uses this to decide
   *  whether to render "(re-pick file)" hints next to recent entries. */
  hasFsAccess: boolean;
}

type Listener = (state: ProjectState) => void;

/** True if `window.showSaveFilePicker` is available — Chromium browsers
 *  on secure contexts get it; Firefox / Safari don't. Cached at boot. */
function detectFsAccess(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export interface ProjectStoreDeps extends ProjectSnapshotDeps, ProjectApplyDeps {
  /** Hook a Settings.subscribeAll into the store so changing any
   *  setting flips the dirty bit. The unsubscribe is owned by the
   *  caller (main.ts) but in practice we live for the page lifetime. */
  subscribeAllSettings: (fn: () => void) => () => void;
}

export class ProjectStore {
  private deps: ProjectStoreDeps;
  private listeners = new Set<Listener>();
  private state: ProjectState;
  /** Handle for the file we last saved to / opened from, when the
   *  FS Access API is available. Plain Save writes back to this. */
  private currentHandle: FileSystemFileHandle | null = null;

  constructor(deps: ProjectStoreDeps) {
    this.deps = deps;
    this.state = {
      name: null,
      dirty: false,
      recent: loadRecent(),
      hasFsAccess: detectFsAccess(),
    };
    // Wire dirty tracking. Settings changes drive most of the dirty
    // state; explicit `markDirty()` calls cover preset / timeline
    // changes that don't pass through Settings.
    deps.subscribeAllSettings(() => this.markDirty());
  }

  // ============================================================
  // Public API — observation
  // ============================================================

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): ProjectState { return { ...this.state }; }

  /** Programmatic dirty flip. UI calls this after preset save / delete
   *  or timeline edits so the title bar updates even when no Setting
   *  changed. */
  markDirty(): void {
    if (this.state.dirty) return;
    this.state = { ...this.state, dirty: true };
    this.emit();
  }

  /** Internal: clear dirty after a successful save / open. */
  private markClean(): void {
    if (!this.state.dirty) return;
    this.state = { ...this.state, dirty: false };
    this.emit();
  }

  // ============================================================
  // Public API — file ops
  // ============================================================

  /**
   * Reset to defaults. Settings are wiped to factory defaults via
   * `settings.reset()`, presets and timelines emptied. After this
   * the store reports name=null, dirty=false.
   *
   * Caller should run their own "Save first?" confirm dialog if
   * `state.dirty` is true — see `confirmDiscardIfDirty()` helper.
   */
  newProject(): void {
    this.deps.settings.reset();
    this.deps.setUserPresets([]);
    this.deps.setTimelines([], undefined);
    this.currentHandle = null;
    this.state = { ...this.state, name: null };
    this.markClean();
  }

  /** Build a SynthProject snapshot of the current session. Used by
   *  AutoSave + tests. */
  snapshot(name: string, description?: string): SynthProject {
    return snapshotProject(this.deps, { name, description });
  }

  /**
   * Save to a previously-known file (FSA handle if we have one,
   * download otherwise). Returns true on success.
   */
  async saveToCurrent(): Promise<boolean> {
    const name = this.state.name ?? 'Untitled Project';
    const project = this.snapshot(name);
    const json = serializeProject(project);

    if (this.currentHandle) {
      try {
        await writeHandle(this.currentHandle, json);
        this.bumpRecent({
          name,
          savedAt: project.savedAt,
          lastOpenedAt: new Date().toISOString(),
          handle: this.currentHandle,
        });
        this.markClean();
        return true;
      } catch (err) {
        // Permission revoked or handle stale — fall through to
        // SaveAs which re-prompts.
        console.warn('[project] saveToCurrent fell back to Save As', err);
        return this.saveAs(name);
      }
    }
    return this.saveAs(name);
  }

  /**
   * Save to a new file. Uses the FS Access API on supporting
   * browsers; falls back to a hidden anchor download otherwise.
   * Returns true on success.
   */
  async saveAs(suggestedName: string): Promise<boolean> {
    const cleanName = suggestedName.trim() || 'Untitled Project';
    const fileName = filenameForProject(cleanName);
    const project = this.snapshot(cleanName);
    const json = serializeProject(project);

    if (this.state.hasFsAccess) {
      try {
        const handle = await openSavePicker(fileName);
        if (!handle) return false;
        await writeHandle(handle, json);
        this.currentHandle = handle;
        this.state = { ...this.state, name: cleanName };
        this.bumpRecent({
          name: cleanName,
          savedAt: project.savedAt,
          lastOpenedAt: new Date().toISOString(),
          handle,
        });
        this.markClean();
        return true;
      } catch (err) {
        if (isAbortError(err)) return false;
        console.warn('[project] FS Access save failed, falling back to download', err);
        // Continue to fallback path.
      }
    }

    // Download fallback — works everywhere but the user has to pick
    // a download location instead of overwriting.
    triggerDownload(fileName, json);
    this.currentHandle = null;
    this.state = { ...this.state, name: cleanName };
    this.bumpRecent({
      name: cleanName,
      savedAt: project.savedAt,
      lastOpenedAt: new Date().toISOString(),
    });
    this.markClean();
    return true;
  }

  /**
   * Open a project file via the FS Access API picker, then apply
   * it. Returns the summary on success, null on cancel / error.
   */
  async openWithPicker(): Promise<ProjectSummary | null> {
    if (!this.state.hasFsAccess) return null;
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await openOpenPicker();
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    const summary = await this.openFromText(text, file.name.replace(/\.synth\.json$/i, ''));
    if (summary) {
      this.currentHandle = handle;
      this.bumpRecent({
        name: summary.name,
        savedAt: summary.savedAt,
        lastOpenedAt: new Date().toISOString(),
        handle,
      });
    }
    return summary;
  }

  /** Open from a `File` object (download-fallback path). */
  async openFromFile(file: File): Promise<ProjectSummary | null> {
    const text = await file.text();
    const fallbackName = file.name.replace(/\.synth\.json$/i, '');
    const summary = await this.openFromText(text, fallbackName);
    if (summary) {
      this.currentHandle = null; // no FSA path on this branch
      this.bumpRecent({
        name: summary.name,
        savedAt: summary.savedAt,
        lastOpenedAt: new Date().toISOString(),
      });
    }
    return summary;
  }

  /** Open from a JSON string. Used by AutoSave's recovery path and
   *  tests. */
  async openFromText(text: string, fallbackName: string): Promise<ProjectSummary | null> {
    const parsed = parseProject(text);
    const summary = applyProject(parsed, this.deps);
    this.state = { ...this.state, name: parsed.name || fallbackName };
    this.markClean();
    return summary;
  }

  /** Re-open a recent entry. Returns the summary or null on
   *  failure / cancel. */
  async openRecent(entry: RecentProjectEntry): Promise<ProjectSummary | null> {
    if (!entry.handle) {
      // No handle — the UI must trigger the file picker. Caller
      // detects null + .handle absent and renders a hint.
      return null;
    }
    try {
      // Permission may have lapsed — re-request.
      const perm = await requestReadPermission(entry.handle);
      if (perm !== 'granted') return null;
      const file = await entry.handle.getFile();
      const text = await file.text();
      const summary = await this.openFromText(text, entry.name);
      if (summary) {
        this.currentHandle = entry.handle;
        this.bumpRecent({ ...entry, lastOpenedAt: new Date().toISOString() });
      }
      return summary;
    } catch (err) {
      console.warn('[project] openRecent failed', err);
      this.dropRecent(entry);
      return null;
    }
  }

  // ============================================================
  // Recent list
  // ============================================================

  bumpRecent(entry: RecentProjectEntry): void {
    const list = this.state.recent.filter((e) => e.name !== entry.name);
    list.unshift(entry);
    while (list.length > MAX_RECENT) list.pop();
    this.state = { ...this.state, recent: list };
    saveRecent(list);
    this.emit();
  }

  dropRecent(entry: RecentProjectEntry): void {
    const list = this.state.recent.filter((e) => e.name !== entry.name);
    this.state = { ...this.state, recent: list };
    saveRecent(list);
    this.emit();
  }

  clearRecent(): void {
    this.state = { ...this.state, recent: [] };
    saveRecent([]);
    this.emit();
  }

  // ============================================================
  // Internal
  // ============================================================

  private emit(): void {
    for (const fn of this.listeners) fn(this.getState());
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

/** Whether to discard pending changes — caller wraps in `confirm()`
 *  or a custom modal. Returns true to proceed. */
export function confirmDiscardIfDirty(state: ProjectState): boolean {
  if (!state.dirty) return true;
  return confirm(
    'There are unsaved changes in the current project. Continue and lose them?',
  );
}

/** Sanitize a project name into a download filename. */
export function filenameForProject(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${slug || 'project'}.synth.json`;
}

function loadRecent(): RecentProjectEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // FileSystemFileHandle isn't directly serializable to JSON;
    // browsers that survived the IDB-backed handle storage path
    // would have written something here that decoded back to a
    // handle. In our simple localStorage approach handles don't
    // round-trip through JSON, so we drop them and the user
    // re-picks. The plain-name fallback is the documented behavior
    // for browsers without the experimental handle persistence.
    return parsed.map((e: Partial<RecentProjectEntry>) => ({
      name: typeof e.name === 'string' ? e.name : 'Untitled',
      savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
      lastOpenedAt: typeof e.lastOpenedAt === 'string' ? e.lastOpenedAt : '',
      // handle intentionally NOT restored — see comment above.
    }));
  } catch {
    return [];
  }
}

function saveRecent(list: RecentProjectEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Strip the handle before serializing — JSON can't round-trip
    // it, and including it produces `{}` which we then have to
    // throw away on load anyway. Smaller payload, clearer intent.
    const stripped = list.map((e) => ({
      name: e.name,
      savedAt: e.savedAt,
      lastOpenedAt: e.lastOpenedAt,
    }));
    localStorage.setItem(RECENT_KEY, JSON.stringify(stripped));
  } catch { /* quota — ignore */ }
}

function triggerDownload(fileName: string, body: string): void {
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function writeHandle(handle: FileSystemFileHandle, body: string): Promise<void> {
  // Permission may have lapsed since the handle was issued.
  const perm = await requestWritePermission(handle);
  if (perm !== 'granted') {
    throw new Error('Permission to write the project file was denied.');
  }
  const writable = await handle.createWritable();
  await writable.write(body);
  await writable.close();
}

async function requestReadPermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as unknown as {
    queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  };
  if (!h.queryPermission || !h.requestPermission) return 'granted';
  let p = await h.queryPermission({ mode: 'read' });
  if (p === 'granted') return p;
  p = await h.requestPermission({ mode: 'read' });
  return p;
}

async function requestWritePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as unknown as {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (!h.queryPermission || !h.requestPermission) return 'granted';
  let p = await h.queryPermission({ mode: 'readwrite' });
  if (p === 'granted') return p;
  p = await h.requestPermission({ mode: 'readwrite' });
  return p;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface OpenFilePickerOptions extends SaveFilePickerOptions {
  multiple?: boolean;
}

async function openSavePicker(suggestedName: string): Promise<FileSystemFileHandle | null> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  };
  if (!w.showSaveFilePicker) return null;
  return w.showSaveFilePicker({
    suggestedName,
    types: [{
      description: 'Rutt/Etra project',
      accept: { 'application/json': ['.synth.json', '.json'] },
    }],
  });
}

async function openOpenPicker(): Promise<FileSystemFileHandle | null> {
  const w = window as unknown as {
    showOpenFilePicker?: (opts: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  };
  if (!w.showOpenFilePicker) return null;
  const list = await w.showOpenFilePicker({
    multiple: false,
    types: [{
      description: 'Rutt/Etra project',
      accept: { 'application/json': ['.synth.json', '.json'] },
    }],
  });
  return list[0] ?? null;
}

function isAbortError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'name' in err) {
    return (err as { name: string }).name === 'AbortError';
  }
  return false;
}
