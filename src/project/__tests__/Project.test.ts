import { describe, expect, it, beforeEach } from 'vitest';
import {
  serializeProject, parseProject, snapshotProject, applyProject,
  summarize, describeSummary, presetFromProject, migrateProject,
  APP_VERSION,
} from '../Project';
import {
  PROJECT_FORMAT_VERSION, PROJECT_TYPE_TAG, SynthProject,
} from '../types';
import { SettingsStore, DEFAULTS } from '../../state/Settings';
import type { Timeline } from '../../sequencer/types';

function freshSettings(): SettingsStore {
  return new SettingsStore();
}

const EMPTY_TIMELINE: Timeline = {
  _v: 1,
  id: 'tl-test',
  name: 'Test Timeline',
  beatsPerBar: 4,
  lengthBars: 16,
  loop: true,
  syncMode: 'internal',
  excludedParams: [],
  keyframes: [],
};

describe('Project — snapshot', () => {
  it('captures current settings + presets + timelines', () => {
    const settings = freshSettings();
    settings.set('threshold', 0.42);
    const userPresets = [{ id: 'p1', name: 'Mine', values: { contrast: 1.5 } }];
    const timelines = [{ ...EMPTY_TIMELINE }];

    const project = snapshotProject({
      settings,
      getUserPresets: () => userPresets,
      getTimelines: () => timelines,
      getActiveTimelineId: () => 'tl-test',
    }, { name: 'Hello' });

    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(project.type).toBe(PROJECT_TYPE_TAG);
    expect(project.name).toBe('Hello');
    expect(project.appVersion).toBe(APP_VERSION);
    expect(project.userPresets).toEqual(userPresets);
    expect(project.timelines).toEqual(timelines);
    expect(project.activeTimelineId).toBe('tl-test');
    // Settings snapshot includes the modified value.
    expect((project.settings as { threshold: number }).threshold).toBe(0.42);
  });

  it('handles missing optional deps', () => {
    const settings = freshSettings();
    const project = snapshotProject({
      settings,
      getUserPresets: () => [],
      getTimelines: () => [],
    }, { name: 'No timelines' });
    expect(project.activeTimelineId).toBeUndefined();
    expect(project.timelines).toEqual([]);
  });
});

describe('Project — serialize / parse round-trip', () => {
  it('round-trips a full project unchanged (modulo savedAt)', () => {
    const settings = freshSettings();
    settings.set('threshold', 0.42);
    const project = snapshotProject({
      settings,
      getUserPresets: () => [{ id: 'p1', name: 'Mine', values: {} }],
      getTimelines: () => [EMPTY_TIMELINE],
    }, { name: 'Round Trip', description: 'a test' });

    const json = serializeProject(project);
    const parsed = parseProject(json);

    expect(parsed.name).toBe('Round Trip');
    expect(parsed.description).toBe('a test');
    expect(parsed.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(parsed.type).toBe(PROJECT_TYPE_TAG);
    expect(parsed.userPresets).toHaveLength(1);
    expect(parsed.timelines).toHaveLength(1);
    expect((parsed.settings as { threshold: number }).threshold).toBe(0.42);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseProject('not json'))
      .toThrow(/valid JSON/);
  });

  it('rejects an object with the wrong type tag', () => {
    expect(() => parseProject(JSON.stringify({
      formatVersion: 1, type: 'ruttetra-preset', name: 'X', settings: {}, userPresets: [], timelines: [],
    }))).toThrow(/isn't a Rutt\/Etra project/);
  });

  it('rejects formatVersion < 1', () => {
    expect(() => parseProject(JSON.stringify({
      type: PROJECT_TYPE_TAG, formatVersion: 0,
    }))).toThrow(/formatVersion/);
  });

  it('warns but accepts formatVersion > current (forward-compat)', () => {
    const future = JSON.stringify({
      type: PROJECT_TYPE_TAG,
      formatVersion: PROJECT_FORMAT_VERSION + 99,
      name: 'Future',
      settings: {},
      userPresets: [],
      timelines: [],
    });
    const parsed = parseProject(future);
    // Migration normalizes back to current version.
    expect(parsed.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(parsed.name).toBe('Future');
  });
});

describe('Project — migrate fills missing fields safely', () => {
  it('fills empty arrays when missing', () => {
    const partial: Partial<SynthProject> = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, name: 'Sparse',
    };
    const out = migrateProject(partial);
    expect(out.userPresets).toEqual([]);
    expect(out.timelines).toEqual([]);
    expect(out.settings).toEqual({});
  });

  it('replaces a missing name with "Untitled Project"', () => {
    const out = migrateProject({ type: PROJECT_TYPE_TAG, formatVersion: 1 });
    expect(out.name).toBe('Untitled Project');
  });

  it('preserves an explicit description', () => {
    const out = migrateProject({
      type: PROJECT_TYPE_TAG, formatVersion: 1,
      description: 'notes here',
    });
    expect(out.description).toBe('notes here');
  });
});

describe('Project — applyProject safety rules', () => {
  let settings: SettingsStore;
  let userPresetsBucket: { id: string; name: string; values: Record<string, unknown> }[];
  let timelinesBucket: Timeline[];
  let activeTimelineApplied: string | undefined;

  beforeEach(() => {
    settings = freshSettings();
    userPresetsBucket = [];
    timelinesBucket = [];
    activeTimelineApplied = undefined;
  });

  function makeApplyDeps() {
    return {
      settings,
      setUserPresets: (l: typeof userPresetsBucket) => { userPresetsBucket = l; },
      setTimelines:   (l: Timeline[], a?: string) => {
        timelinesBucket = l;
        activeTimelineApplied = a;
      },
    };
  }

  it('FORCES sonification.enabled = false on load (cardinal safety rule)', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'p',
      settings: {
        sonification: {
          ...DEFAULTS.sonification,
          enabled: true, // attempting to come back enabled
          masterVolumeDb: -6,
        },
      },
      userPresets: [], timelines: [],
    };
    applyProject(project, makeApplyDeps());
    const son = settings.get('sonification');
    expect(son.enabled).toBe(false);
    // ...but the user's volume preference is preserved.
    expect(son.masterVolumeDb).toBe(-6);
  });

  it('FORCES cvOutputEnabled = false on load', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'p',
      settings: {
        cvOutputEnabled: true, // attempting to come back enabled
      },
      userPresets: [], timelines: [],
    };
    applyProject(project, makeApplyDeps());
    expect(settings.get('cvOutputEnabled')).toBe(false);
  });

  it('forces every cvOutputChannels[].enabled = false on load', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'p',
      settings: {
        cvOutputChannels: [
          { ...((DEFAULTS as unknown as { cvOutputChannels: unknown[] }).cvOutputChannels[0] ?? {}), enabled: true } as never,
          { ...((DEFAULTS as unknown as { cvOutputChannels: unknown[] }).cvOutputChannels[0] ?? {}), enabled: true } as never,
        ],
      },
      userPresets: [], timelines: [],
    };
    applyProject(project, makeApplyDeps());
    const ch = settings.get('cvOutputChannels');
    for (const c of ch) expect(c.enabled).toBe(false);
  });

  it('routes settings through migrateSettings (older _v migrates forward)', () => {
    // Build a v9-shaped project — sonification missing entirely.
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'old',
      settings: { _v: 9 } as never,
      userPresets: [], timelines: [],
    };
    applyProject(project, makeApplyDeps());
    // Settings now has the migrated shape — sonification block exists.
    const son = settings.get('sonification');
    expect(son).toBeDefined();
    expect(son.enabled).toBe(false);
  });

  it('replaces user presets and timelines wholesale', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'p',
      settings: {},
      userPresets: [{ id: 'a', name: 'A', values: {} }],
      timelines: [{ ...EMPTY_TIMELINE, id: 'tl-loaded' }],
      activeTimelineId: 'tl-loaded',
    };
    applyProject(project, makeApplyDeps());
    expect(userPresetsBucket).toHaveLength(1);
    expect(userPresetsBucket[0].id).toBe('a');
    expect(timelinesBucket).toHaveLength(1);
    expect(timelinesBucket[0].id).toBe('tl-loaded');
    expect(activeTimelineApplied).toBe('tl-loaded');
  });
});

describe('Project — summarize / describeSummary', () => {
  it('counts every subsystem', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'demo',
      settings: {
        midiBindings: [{} as never, {} as never],
        oscBindings: [{} as never],
        cvChannels: [{} as never, {} as never, {} as never],
        cvOutputChannels: [{} as never],
        sonification: { ...DEFAULTS.sonification, enabled: false },
        patternEnabled: true,
      },
      userPresets: [{ id: 'a', name: 'A', values: {} }, { id: 'b', name: 'B', values: {} }],
      timelines: [{ ...EMPTY_TIMELINE, keyframes: [{ id: 'k', bar: 0, presetSnapshot: {}, easing: 'linear' }] }],
    };
    const s = summarize(project);
    expect(s.midiBindingCount).toBe(2);
    expect(s.oscBindingCount).toBe(1);
    expect(s.cvInputCount).toBe(3);
    expect(s.cvOutputCount).toBe(1);
    expect(s.sonificationConfigured).toBe(true);
    expect(s.patternEnabled).toBe(true);
    expect(s.presetCount).toBe(2);
    expect(s.timelineCount).toBe(1);
    expect(s.keyframeCount).toBe(1);
  });

  it('produces a human-readable summary string', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'My Set',
      settings: { midiBindings: [{} as never] },
      userPresets: [], timelines: [],
    };
    const desc = describeSummary(summarize(project));
    expect(desc).toContain('My Set');
    expect(desc).toContain('1 MIDI binding');
  });
});

describe('Project — presetFromProject', () => {
  it('strips UI-only keys from the project settings', () => {
    const project: SynthProject = {
      formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
      savedAt: new Date().toISOString(), name: 'p',
      settings: {
        contrast: 1.4 as never,
        modSlotExpanded: { 0: true } as never,
        panelDock: 'right' as never,
        helpSeen: true as never,
      },
      userPresets: [], timelines: [],
    };
    const preset = presetFromProject(project) as Record<string, unknown>;
    expect(preset.contrast).toBe(1.4);
    // UI-only keys are dropped.
    expect(preset.modSlotExpanded).toBeUndefined();
    expect(preset.panelDock).toBeUndefined();
    expect(preset.helpSeen).toBeUndefined();
  });
});
