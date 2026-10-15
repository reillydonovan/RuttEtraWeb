import { describe, expect, it, beforeEach } from 'vitest';
import { ProjectStore, filenameForProject, confirmDiscardIfDirty } from '../ProjectStore';
import { SettingsStore } from '../../state/Settings';
import type { Timeline } from '../../sequencer/types';
import type { UserPresetEntry } from '../types';

// Minimal localStorage stub for the node test environment so the
// recent-list tests can exercise persistence end-to-end.
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  // Stub `window` so detectFsAccess returns false in tests.
  (globalThis as unknown as { window: { showSaveFilePicker?: unknown } }).window = {};
});

interface TestSetup {
  store: ProjectStore;
  settings: SettingsStore;
  presetsBucket: UserPresetEntry[];
  timelinesBucket: Timeline[];
  activeTimelineId: string | null;
  fireSettingsAll: () => void;
}

function setup(): TestSetup {
  const settings = new SettingsStore();
  const setupRef = {} as TestSetup;
  setupRef.settings = settings;
  setupRef.presetsBucket = [];
  setupRef.timelinesBucket = [];
  setupRef.activeTimelineId = null;
  let dirtyHook: (() => void) | null = null;
  setupRef.fireSettingsAll = () => dirtyHook?.();

  setupRef.store = new ProjectStore({
    settings,
    getUserPresets: () => setupRef.presetsBucket,
    setUserPresets: (l) => { setupRef.presetsBucket = l; },
    getTimelines: () => setupRef.timelinesBucket,
    setTimelines: (l, a) => {
      setupRef.timelinesBucket = l;
      setupRef.activeTimelineId = a ?? null;
    },
    getActiveTimelineId: () => setupRef.activeTimelineId,
    subscribeAllSettings: (fn) => { dirtyHook = fn; return () => { dirtyHook = null; }; },
  });
  return setupRef;
}

describe('ProjectStore — initial state', () => {
  it('boots with no name, not dirty, empty recent list', () => {
    const { store } = setup();
    const s = store.getState();
    expect(s.name).toBeNull();
    expect(s.dirty).toBe(false);
    expect(s.recent).toEqual([]);
  });

  it('subscribe fires once with current state', () => {
    const { store } = setup();
    let calls = 0;
    let last: typeof store extends { getState(): infer S } ? S : never = null as never;
    store.subscribe((s) => { calls++; last = s; });
    expect(calls).toBe(1);
    expect(last.dirty).toBe(false);
  });
});

describe('ProjectStore — dirty tracking', () => {
  it('flips dirty when subscribeAllSettings fires', () => {
    const { store, fireSettingsAll } = setup();
    expect(store.getState().dirty).toBe(false);
    fireSettingsAll();
    expect(store.getState().dirty).toBe(true);
  });

  it('emits exactly once per dirty transition (no duplicate emits)', () => {
    const { store, fireSettingsAll } = setup();
    let calls = 0;
    store.subscribe(() => { calls++; });
    expect(calls).toBe(1); // initial
    fireSettingsAll();
    expect(calls).toBe(2); // dirty=true
    fireSettingsAll();
    expect(calls).toBe(2); // already dirty, no emit
  });

  it('markDirty() is idempotent', () => {
    const { store } = setup();
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.markDirty();
    expect(calls).toBe(2);
    store.markDirty();
    expect(calls).toBe(2);
  });

  it('rename() sets the name, marks dirty, emits once; blank means untitled; same name is a no-op', () => {
    const { store } = setup();
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.rename('  My Set  ');
    expect(store.getState().name).toBe('My Set');
    expect(store.getState().dirty).toBe(true);
    expect(calls).toBe(2);
    store.rename('My Set');
    expect(calls).toBe(2);
    store.rename('   ');
    expect(store.getState().name).toBeNull();
  });

  it('newProject() clears dirty', () => {
    const { store, fireSettingsAll } = setup();
    fireSettingsAll();
    expect(store.getState().dirty).toBe(true);
    store.newProject();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().name).toBeNull();
  });
});

describe('ProjectStore — newProject', () => {
  it('resets settings, presets, and timelines', () => {
    const setupRef = setup();
    setupRef.settings.set('threshold', 0.99);
    setupRef.presetsBucket = [{ id: 'p', name: 'P', values: {} }];
    setupRef.timelinesBucket = [{ _v: 2, id: 't', name: 't', beatsPerBar: 4, lengthBars: 16, loop: true, syncMode: 'internal', excludedParams: [], keyframes: [], lanes: [] }];

    setupRef.store.newProject();

    // Settings reset to factory.
    expect(setupRef.settings.get('threshold')).not.toBe(0.99);
    expect(setupRef.presetsBucket).toEqual([]);
    expect(setupRef.timelinesBucket).toEqual([]);
  });
});

describe('ProjectStore — recent list', () => {
  it('bumpRecent prepends and dedupes by name', () => {
    const { store } = setup();
    const a = { name: 'A', savedAt: '2026-01-01', lastOpenedAt: '2026-01-01' };
    const b = { name: 'B', savedAt: '2026-01-02', lastOpenedAt: '2026-01-02' };
    store.bumpRecent(a);
    store.bumpRecent(b);
    expect(store.getState().recent.map((r) => r.name)).toEqual(['B', 'A']);
    // Re-bumping A moves it back to the front, no duplicate.
    store.bumpRecent({ ...a, lastOpenedAt: '2026-01-03' });
    expect(store.getState().recent.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('caps the recent list at 8 entries', () => {
    const { store } = setup();
    for (let i = 0; i < 12; i++) {
      store.bumpRecent({ name: `P${i}`, savedAt: '', lastOpenedAt: '' });
    }
    expect(store.getState().recent).toHaveLength(8);
    expect(store.getState().recent[0].name).toBe('P11');
  });

  it('clearRecent empties the list and persists', () => {
    const { store } = setup();
    store.bumpRecent({ name: 'A', savedAt: '', lastOpenedAt: '' });
    store.clearRecent();
    expect(store.getState().recent).toEqual([]);
    // Persisted: a fresh store reads []
    const fresh = setup().store;
    expect(fresh.getState().recent).toEqual([]);
  });

  it('persists across stores via localStorage', () => {
    const a = setup();
    a.store.bumpRecent({ name: 'A', savedAt: '2026', lastOpenedAt: '2026' });
    const b = setup(); // new store, same localStorage
    expect(b.store.getState().recent.map((r) => r.name)).toEqual(['A']);
  });

  it('drops the FileSystemFileHandle on persist (handles dont round-trip JSON)', () => {
    const a = setup();
    const fakeHandle = { fake: true } as unknown as FileSystemFileHandle;
    a.store.bumpRecent({ name: 'A', savedAt: '', lastOpenedAt: '', handle: fakeHandle });
    const b = setup();
    expect(b.store.getState().recent[0].handle).toBeUndefined();
  });
});

describe('ProjectStore — openFromText', () => {
  it('applies a parsed project and updates the name', async () => {
    const { store, settings } = setup();
    const project = JSON.stringify({
      formatVersion: 1, type: 'ruttetra-project',
      appVersion: 'test', savedAt: '2026-01-01', name: 'Loaded',
      settings: { threshold: 0.123 },
      userPresets: [], timelines: [],
    });
    const summary = await store.openFromText(project, 'fallback');
    expect(summary).not.toBeNull();
    expect(store.getState().name).toBe('Loaded');
    expect(store.getState().dirty).toBe(false);
    expect(settings.get('threshold')).toBe(0.123);
  });

  it('uses fallback name when project name is empty', async () => {
    const { store } = setup();
    const project = JSON.stringify({
      formatVersion: 1, type: 'ruttetra-project',
      name: '', settings: {}, userPresets: [], timelines: [],
    });
    await store.openFromText(project, 'my-fallback');
    // migrateProject normalizes empty name → 'Untitled Project',
    // not the fallback. Fallback only kicks in if migrate produces
    // an empty string, which it doesn't.
    expect(store.getState().name).toBe('Untitled Project');
  });

  it('throws on a non-project file', async () => {
    const { store } = setup();
    const notAProject = JSON.stringify({ type: 'ruttetra-preset' });
    await expect(store.openFromText(notAProject, 'x')).rejects.toThrow(/Rutt\/Etra project/);
  });
});

describe('ProjectStore — helpers', () => {
  it('filenameForProject sanitizes weird names', () => {
    expect(filenameForProject('Hello World')).toBe('hello-world.synth.json');
    expect(filenameForProject('  weird/path\\stuff  ')).toBe('weird-path-stuff.synth.json');
    expect(filenameForProject('')).toBe('project.synth.json');
    expect(filenameForProject('!!!@@@###')).toBe('project.synth.json');
  });

  it('confirmDiscardIfDirty returns true immediately when not dirty', () => {
    expect(confirmDiscardIfDirty({
      name: 'x', dirty: false, recent: [], hasFsAccess: false,
    })).toBe(true);
  });
});
