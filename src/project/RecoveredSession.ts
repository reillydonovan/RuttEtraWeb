/**
 * RecoveredSession — first-launch packaging of pre-Project state.
 *
 * Before the Project save/load feature, the synth scattered its
 * persistent state across three localStorage keys:
 *
 *   - `ruttetra.settings.v1`     (full Settings snapshot, written
 *                                  by the legacy "Save Settings"
 *                                  / hardware-trim auto-persist)
 *   - `ruttetra.userPresets.v1`  (named user presets)
 *   - `ruttetra.timelines.v1`    (saved timelines, when autoPersist
 *                                  was enabled)
 *
 * Most users never use those (the GUI starts fresh on every refresh
 * by design). But the few that DO have meaningful data there
 * shouldn't lose it when Projects ships. On the very first boot
 * after the Project feature lands, if any of those keys hold real
 * data, package them as an auto-save payload named "Recovered
 * Session". The next page load surfaces it through the same
 * recovery prompt that `AutoSave` uses, so the user can choose to
 * restore it as a Project or discard it.
 *
 * Only runs once. A flag (`ruttetra.project.recoveredAt`) records
 * when it ran so subsequent refreshes don't re-package the same
 * data over and over.
 */

import {
  PROJECT_FORMAT_VERSION, PROJECT_TYPE_TAG, SynthProject,
} from './types';
import { APP_VERSION } from './Project';

const FLAG_KEY = 'ruttetra.project.recoveredAt';
const AUTOSAVE_KEY = 'ruttetra.project.autosave.v1';

const SETTINGS_KEY     = 'ruttetra.settings.v1';
const USER_PRESETS_KEY = 'ruttetra.userPresets.v1';
const TIMELINES_KEY    = 'ruttetra.timelines.v1';

/** Run the one-time packaging step. No-op when already run, no-op
 *  when there's nothing to recover. Returns true iff a Recovered
 *  Session payload was written. */
export function maybePackageRecoveredSession(): boolean {
  if (typeof localStorage === 'undefined') return false;
  // Already ran? Don't re-package.
  if (localStorage.getItem(FLAG_KEY)) return false;
  // Already a pending auto-save? Don't clobber it.
  if (localStorage.getItem(AUTOSAVE_KEY)) {
    markFlag();
    return false;
  }

  const settingsJson  = readJsonOr<Record<string, unknown> | null>(SETTINGS_KEY, null);
  const userPresets   = readJsonOr<unknown[]>(USER_PRESETS_KEY, []);
  const timelines     = readJsonOr<unknown[]>(TIMELINES_KEY, []);

  const hasSomething =
    (settingsJson && typeof settingsJson === 'object' && Object.keys(settingsJson).length > 0)
    || (Array.isArray(userPresets) && userPresets.length > 0)
    || (Array.isArray(timelines) && timelines.length > 0);

  if (!hasSomething) {
    markFlag();
    return false;
  }

  const project: SynthProject = {
    formatVersion: PROJECT_FORMAT_VERSION,
    type: PROJECT_TYPE_TAG,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    name: 'Recovered Session',
    description:
      'Auto-packaged from pre-Project session state. Save to file ' +
      'to preserve permanently — otherwise this stays in browser ' +
      'storage only.',
    settings: (settingsJson ?? {}) as SynthProject['settings'],
    userPresets: (userPresets as SynthProject['userPresets']),
    timelines: (timelines as SynthProject['timelines']),
  };

  const payload = {
    writtenAt: new Date().toISOString(),
    projectName: project.name,
    json: JSON.stringify(project, null, 2),
  };
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    markFlag();
    return true;
  } catch (err) {
    console.warn('[recovered-session] failed to write payload', err);
    return false;
  }
}

function markFlag(): void {
  try { localStorage.setItem(FLAG_KEY, new Date().toISOString()); } catch { /* ignore */ }
}

function readJsonOr<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
