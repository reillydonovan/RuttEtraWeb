/**
 * Project — pure helpers for snapshotting current state into a
 * `SynthProject`, serializing to / from JSON, and migrating older
 * project format versions.
 *
 * No DOM access, no localStorage, no listeners — that's all in
 * `ProjectStore`. This module is unit-testable in isolation.
 *
 * Safety surface:
 *   - `loadProject()` always routes through `migrateSettings()`,
 *     which forces `cvOutputEnabled = false`, every
 *     `cvOutputChannels[i].enabled = false`, and
 *     `sonification.enabled = false`. Hardware-output features
 *     never auto-enable from a saved file. Mirrors the existing
 *     CV-output and sonification "start at zero" rules and is
 *     called out in the spec as non-negotiable.
 *   - The type tag (`type: 'ruttetra-project'`) and a non-numeric
 *     `formatVersion` are validated up-front so we don't half-load
 *     a preset file or a timeline file by mistake.
 */

import {
  Settings, SettingsStore, migrateSettings,
} from '../state/Settings';
import { Timeline } from '../sequencer/types';
import {
  SynthProject, UserPresetEntry, ProjectSummary,
  PROJECT_FORMAT_VERSION, PROJECT_TYPE_TAG,
} from './types';

/** App version reported in saved project metadata. Reads the same
 *  `__BUILD_INFO__` define that stamps the panel title bar and boot
 *  overlay (one version, one source); falls back to a human-readable
 *  token where the define doesn't exist (node test environment). */
export const APP_VERSION = readAppVersion();

function readAppVersion(): string {
  try {
    if (typeof __BUILD_INFO__ !== 'undefined') return __BUILD_INFO__.version;
  } catch { /* fall through */ }
  return 'dev';
}

// --------------------------------------------------------------------
// Snapshot — build a project from the current live state.
// --------------------------------------------------------------------

/** Inputs needed to assemble a project file from the current session.
 *  Kept as a plain interface so callers can stub each piece in tests. */
export interface ProjectSnapshotDeps {
  settings: SettingsStore;
  /** Returns the current user-presets list. The synth stores this
   *  in `localStorage` under `ruttetra.userPresets.v1`; the UI
   *  layer threads in the in-memory copy when persistence is
   *  disabled. */
  getUserPresets: () => UserPresetEntry[];
  /** Current timelines list, ditto. */
  getTimelines: () => Timeline[];
  /** Optional: id of the timeline currently loaded into the
   *  Sequencer. Restored on `applyProject`. */
  getActiveTimelineId?: () => string | null;
}

/** Build a `SynthProject` describing the current live state. Pure —
 *  doesn't touch the DOM, doesn't write the file. The caller (UI
 *  layer) is responsible for running it through `serializeProject()`
 *  and triggering the actual download / FS write. */
export function snapshotProject(deps: ProjectSnapshotDeps, opts: {
  name: string;
  description?: string;
}): SynthProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    type: PROJECT_TYPE_TAG,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    name: opts.name,
    description: opts.description,
    settings: deps.settings.all,
    userPresets: deps.getUserPresets(),
    timelines: deps.getTimelines(),
    activeTimelineId: deps.getActiveTimelineId?.() ?? undefined,
  };
}

// --------------------------------------------------------------------
// Serialize / parse
// --------------------------------------------------------------------

/** JSON-stringify a project. Standard pretty-print so files diff
 *  cleanly in version control. */
export function serializeProject(p: SynthProject): string {
  return JSON.stringify(p, null, 2);
}

/** Parse + validate + migrate. Throws a descriptive Error on any
 *  structural problem. */
export function parseProject(json: string): SynthProject {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`Project file isn't valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Project file is empty or not an object.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type !== PROJECT_TYPE_TAG) {
    throw new Error(
      `This file isn't a Rutt/Etra project (type="${String(obj.type)}"). ` +
      'Looks like a preset or timeline — use the Presets / Timeline ' +
      'import buttons instead.',
    );
  }
  const fv = typeof obj.formatVersion === 'number' ? obj.formatVersion : 0;
  if (!Number.isFinite(fv) || fv < 1) {
    throw new Error(`Unrecognized project formatVersion: ${String(obj.formatVersion)}`);
  }
  if (fv > PROJECT_FORMAT_VERSION) {
    // Forward-compat is best-effort only. Newer-than-current files
    // will load with the unknown fields preserved — but the user's
    // build doesn't know what they mean, so warn and continue. A
    // round-trip save will rewrite at the current version.
    console.warn(
      `[project] file formatVersion ${fv} is newer than this build's ` +
      `${PROJECT_FORMAT_VERSION}. Loading with best-effort compatibility.`,
    );
  }
  const migrated = migrateProject(obj as Partial<SynthProject>);
  validateProject(migrated);
  return migrated;
}

/** Run any pre-load schema migrations. Today's schema is v1 so this
 *  is a no-op; the function exists so future bumps slot in cleanly. */
export function migrateProject(p: Partial<SynthProject>): SynthProject {
  // Future: if (p.formatVersion < 2) { ...transform... ; p.formatVersion = 2; }
  // For now, fill missing optional fields with safe defaults.
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    type: PROJECT_TYPE_TAG,
    appVersion: typeof p.appVersion === 'string' ? p.appVersion : 'unknown',
    savedAt: typeof p.savedAt === 'string' ? p.savedAt : new Date().toISOString(),
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : 'Untitled Project',
    description: typeof p.description === 'string' ? p.description : undefined,
    settings: (p.settings && typeof p.settings === 'object') ? p.settings : {},
    userPresets: Array.isArray(p.userPresets) ? p.userPresets : [],
    timelines: Array.isArray(p.timelines) ? p.timelines : [],
    activeTimelineId: typeof p.activeTimelineId === 'string' ? p.activeTimelineId : undefined,
  };
}

/** Defensive structural validation. Throws on the first problem. */
export function validateProject(p: SynthProject): void {
  if (typeof p.name !== 'string') throw new Error('Project: name must be a string');
  if (!Array.isArray(p.userPresets)) throw new Error('Project: userPresets must be an array');
  if (!Array.isArray(p.timelines)) throw new Error('Project: timelines must be an array');
  if (typeof p.settings !== 'object' || p.settings == null) {
    throw new Error('Project: settings must be an object');
  }
}

// --------------------------------------------------------------------
// Apply — write a parsed project's payload into the live stores.
// --------------------------------------------------------------------

export interface ProjectApplyDeps {
  settings: SettingsStore;
  /** Replace the user-preset list. Caller persists if appropriate. */
  setUserPresets: (list: UserPresetEntry[]) => void;
  /** Replace timelines + select active. Caller decides when the
   *  Sequencer reloads. */
  setTimelines: (list: Timeline[], activeId?: string) => void;
}

/** Apply a parsed project to the live session. Settings are written
 *  through `migrateSettings()` so:
 *    - older settings versions auto-upgrade,
 *    - cvOutputEnabled / cvOutputChannels[].enabled / sonification.enabled
 *      arrive `false` regardless of saved value (the audible-output and
 *      CV-output safety rules are enforced here, structurally).
 *
 *  Returns a `ProjectSummary` for the UI to surface in a toast.
 */
export function applyProject(p: SynthProject, deps: ProjectApplyDeps): ProjectSummary {
  // 1. Settings — merged through the migration so safety rules apply.
  //    `migrateSettings` returns `Partial<Settings> & { _v }`, the
  //    `_v` is a private versioning marker that `SettingsStore.import`
  //    consumes; we strip it before patching since `patch()` only
  //    accepts user-facing keys.
  const migrated = migrateSettings(p.settings as Record<string, unknown>);
  const patch = { ...migrated } as Partial<Settings> & { _v?: number };
  delete patch._v;
  deps.settings.patch(patch);

  // 2. User presets — replace wholesale.
  deps.setUserPresets(p.userPresets);

  // 3. Timelines + active selection.
  deps.setTimelines(p.timelines, p.activeTimelineId);

  return summarize(p);
}

/** Build the lightweight UI summary independently of applying — used
 *  for the recovery-prompt sentence and for tests. */
export function summarize(p: SynthProject): ProjectSummary {
  const s = p.settings as Partial<Settings> & Record<string, unknown>;
  const midiBindings = Array.isArray(s.midiBindings) ? (s.midiBindings as unknown[]).length : 0;
  const oscBindings  = Array.isArray(s.oscBindings)  ? (s.oscBindings  as unknown[]).length : 0;
  const cvIn        = Array.isArray(s.cvChannels)   ? (s.cvChannels   as unknown[]).length : 0;
  const cvOut       = Array.isArray(s.cvOutputChannels) ? (s.cvOutputChannels as unknown[]).length : 0;
  const son = (s.sonification ?? null) as unknown as { mappings?: unknown } | null;
  const sonificationConfigured = !!(son && typeof son === 'object');
  const patternEnabled = s.patternEnabled === true;

  let keyframeCount = 0;
  for (const t of p.timelines) keyframeCount += t.keyframes?.length ?? 0;

  return {
    name: p.name,
    savedAt: p.savedAt,
    appVersion: p.appVersion,
    presetCount: p.userPresets.length,
    timelineCount: p.timelines.length,
    keyframeCount,
    midiBindingCount: midiBindings,
    oscBindingCount: oscBindings,
    cvInputCount: cvIn,
    cvOutputCount: cvOut,
    sonificationConfigured,
    patternEnabled,
  };
}

/** One-line human summary for toast / log output. */
export function describeSummary(s: ProjectSummary): string {
  const bits: string[] = [];
  if (s.midiBindingCount) bits.push(`${s.midiBindingCount} MIDI binding${plural(s.midiBindingCount)}`);
  if (s.oscBindingCount)  bits.push(`${s.oscBindingCount} OSC binding${plural(s.oscBindingCount)}`);
  if (s.cvInputCount)     bits.push(`${s.cvInputCount} CV in`);
  if (s.cvOutputCount)    bits.push(`${s.cvOutputCount} CV out (disabled)`);
  if (s.sonificationConfigured) bits.push('sonification ready (disabled)');
  if (s.patternEnabled)         bits.push('pattern generator on');
  if (s.keyframeCount)          bits.push(`${s.keyframeCount} timeline keyframe${plural(s.keyframeCount)}`);
  if (s.presetCount)            bits.push(`${s.presetCount} user preset${plural(s.presetCount)}`);
  const tail = bits.length ? ` — ${bits.join(', ')}` : '';
  return `Loaded "${s.name}"${tail}.`;
}

function plural(n: number): string { return n === 1 ? '' : 's'; }

// --------------------------------------------------------------------
// Preset-from-project export — strips the project bundle down to
// just the visual preset for sharing without bindings / hardware
// setup. Compatible with `settings.import()` from `PresetsSection`.
// --------------------------------------------------------------------

/** UI-only fields that should never travel inside a shareable preset.
 *  Mirrors the existing exclude set in `PresetsSection.exportBtn`. */
const PRESET_EXCLUDE_KEYS: ReadonlyArray<keyof Settings> = [
  'modSlotExpanded',
  'panelDock', 'panelCollapsed', 'panelTab', 'hudVisible',
  'helpSeen', 'helpAutoOpen', 'helpActiveTab',
  'activeTimelineId',
] as unknown as ReadonlyArray<keyof Settings>;

export function presetFromProject(p: SynthProject): Partial<Settings> {
  const out = { ...p.settings } as Partial<Settings> & Record<string, unknown>;
  for (const k of PRESET_EXCLUDE_KEYS) delete (out as Record<string, unknown>)[k as string];
  return out;
}
