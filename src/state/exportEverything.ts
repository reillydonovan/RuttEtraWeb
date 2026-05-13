/**
 * Cross-cutting "Export Everything" / "Import Everything".
 *
 * Bundles:
 *   - Current settings snapshot
 *   - User presets (`ruttetra.userPresets.v1`)
 *   - Timelines (`ruttetra.timelines.v1`)
 *
 * On import, settings go through `migrateSettings()` so older bundles
 * keep working. User-preset and timeline payloads are written verbatim
 * (their own loaders normalize on read).
 */

import { Settings, migrateSettings } from './Settings';
import type { Timeline } from '../sequencer/types';

const SETTINGS_KEY  = 'ruttetra.settings.v1';
const USER_PRESETS_KEY = 'ruttetra.userPresets.v1';
const TIMELINES_KEY = 'ruttetra.timelines.v1';

export interface UserPreset {
  id: string;
  name: string;
  values: Partial<Settings>;
}

export interface EverythingBundle {
  _v: 1;
  type: 'ruttetra-everything';
  exportedAt: string;
  settings: Partial<Settings>;
  userPresets: UserPreset[];
  timelines: Timeline[];
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

export function exportEverything(): string {
  const bundle: EverythingBundle = {
    _v: 1,
    type: 'ruttetra-everything',
    exportedAt: new Date().toISOString(),
    settings:    readJsonOr<Partial<Settings>>(SETTINGS_KEY,    {}),
    userPresets: readJsonOr<UserPreset[]>(USER_PRESETS_KEY,    []),
    timelines:   readJsonOr<Timeline[]>(TIMELINES_KEY,         []),
  };
  return JSON.stringify(bundle, null, 2);
}

export function importEverything(json: string): void {
  const parsed = JSON.parse(json) as Partial<EverythingBundle>;
  if (!parsed || parsed.type !== 'ruttetra-everything') {
    throw new Error('Not a Rutt/Etra everything bundle');
  }
  // Settings: migrate, then write back.
  if (parsed.settings && typeof parsed.settings === 'object') {
    const migrated = migrateSettings(parsed.settings as Record<string, unknown>);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
  }
  if (Array.isArray(parsed.userPresets)) {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(parsed.userPresets));
  }
  if (Array.isArray(parsed.timelines)) {
    localStorage.setItem(TIMELINES_KEY, JSON.stringify(parsed.timelines));
  }
}
