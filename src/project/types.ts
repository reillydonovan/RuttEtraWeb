/**
 * Project file format — types only.
 *
 * A project is the synth's "save your work" document: a versioned
 * wrapper around the existing `settings + userPresets + timelines`
 * triple, plus project-level metadata (name, description, savedAt)
 * and an active-timeline pointer.
 *
 * Why one big bag instead of the spec's nested {io, sonification,
 * patternGenerator, workspace, rendering, liveState} schema?
 *
 *   The synth's `Settings` object is already the union of every
 *   persistent subsystem (DCU, modulation, camera defaultView, FX,
 *   MIDI/OSC bindings, CV in/out, sonification, pattern generator,
 *   workspace UI, resolution, performance profile, ...). Splitting
 *   it into nested groups would require a per-key allocation rule
 *   and would risk silent loss every time a new field lands. By
 *   carrying the entire Settings snapshot we (a) capture every key
 *   automatically — present and future — and (b) inherit the
 *   migration-side safety guards (`cvOutputEnabled = false`,
 *   `cvOutputChannels[].enabled = false`,
 *   `sonification.enabled = false`) for free on every load.
 *
 *   The user-facing documentation (about page, README, in-app help)
 *   continues to describe the *logical* groups so people who haven't
 *   read the source can still reason about what's saved.
 */

import type { Settings } from '../state/Settings';
import type { Timeline } from '../sequencer/types';

/** User-saved presets — `Partial<Settings>` value blobs with a
 *  display name. Bundled inside projects so opening one preserves
 *  every preset the user had at save time. */
export interface UserPresetEntry {
  id: string;
  name: string;
  values: Partial<Settings>;
}

/** Bumped on breaking schema changes. Add a `migrateProjectV{N}toV{N+1}`
 *  step in `Project.ts` whenever this increases. */
export const PROJECT_FORMAT_VERSION = 1;

export const PROJECT_TYPE_TAG = 'ruttetra-project';

/** Saved file shape. `formatVersion` is independent of `Settings._v`
 *  because settings can migrate within a single project format
 *  version (e.g. v1 project carrying v9 settings continues to load
 *  after a v9→v10 settings migration). */
export interface SynthProject {
  formatVersion: number;
  /** Type marker — guards against loading e.g. a preset file by
   *  mistake. Must equal `PROJECT_TYPE_TAG`. */
  type: typeof PROJECT_TYPE_TAG;
  /** App version that wrote the file. Informational only — not used
   *  for migration decisions. */
  appVersion: string;
  /** ISO timestamp the file was saved. */
  savedAt: string;
  /** User-provided display name. */
  name: string;
  /** Optional notes. */
  description?: string;

  /** Full Settings snapshot at save time, including modulation
   *  patches, MIDI/OSC bindings, CV in/out configs, sonification,
   *  pattern generator state, workspace UI, camera defaultView,
   *  resolution, performance profile, and everything else. Loaded
   *  through `migrateSettings()` so older saves keep working and
   *  CV / sonification arrive disabled. */
  settings: Partial<Settings>;

  /** User presets at save time (separate from the snapshot — these
   *  are the named sounds/looks in the Presets panel). */
  userPresets: UserPresetEntry[];

  /** Timelines at save time. `activeTimelineId` (when present)
   *  selects which one is loaded into the sequencer on open. */
  timelines: Timeline[];
  activeTimelineId?: string;
}

/** Lightweight summary returned to the UI after `loadProject` so the
 *  toast / status strip can describe what was restored without
 *  dragging the full object around. */
export interface ProjectSummary {
  name: string;
  savedAt: string;
  appVersion: string;
  presetCount: number;
  timelineCount: number;
  keyframeCount: number;
  /** Number of MIDI / OSC / CV bindings that were restored (configs
   *  only — actual hardware reconnection happens elsewhere). */
  midiBindingCount: number;
  oscBindingCount: number;
  cvInputCount: number;
  cvOutputCount: number;
  sonificationConfigured: boolean;
  patternEnabled: boolean;
}

/** Recent-projects entry persisted in localStorage. The optional
 *  `handle` is a `FileSystemFileHandle` (only on Chromium for now).
 *  When present, the UI can re-open the file in one click without
 *  prompting the user to re-pick. */
export interface RecentProjectEntry {
  name: string;
  savedAt: string;
  lastOpenedAt: string;
  /** Set by the FS Access API path; absent on Firefox / Safari and
   *  on URL-imported projects. The handle isn't transferable across
   *  sessions on every browser, but where it survives we use it. */
  handle?: FileSystemFileHandle;
}
