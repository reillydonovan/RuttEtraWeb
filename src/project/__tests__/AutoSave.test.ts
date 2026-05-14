import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AutoSave } from '../AutoSave';
import { ProjectStore } from '../ProjectStore';
import { SettingsStore } from '../../state/Settings';

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
  (globalThis as unknown as { window: { showSaveFilePicker?: unknown } }).window = {};
});

function makeStore(): { store: ProjectStore; fireDirty: () => void } {
  const settings = new SettingsStore();
  let fire: (() => void) | null = null;
  const store = new ProjectStore({
    settings,
    getUserPresets: () => [],
    setUserPresets: () => {},
    getTimelines: () => [],
    setTimelines: () => {},
    getActiveTimelineId: () => null,
    subscribeAllSettings: (fn) => { fire = fn; return () => { fire = null; }; },
  });
  return { store, fireDirty: () => fire?.() };
}

describe('AutoSave', () => {
  it('starts disabled and reports state', () => {
    const { store } = makeStore();
    const a = new AutoSave(store);
    expect(a.isEnabled()).toBe(false);
  });

  it('start() flips enabled and is idempotent', () => {
    const { store } = makeStore();
    const a = new AutoSave(store);
    a.start();
    expect(a.isEnabled()).toBe(true);
    a.start(); // no-op
    expect(a.isEnabled()).toBe(true);
  });

  it('persists enabled flag across instances', () => {
    const a = new AutoSave(makeStore().store);
    a.start();
    a.stop();
    expect(a.isEnabled()).toBe(false);
    // A new instance after start would auto-resume...
    const b = new AutoSave(makeStore().store);
    expect(b.isEnabled()).toBe(false);

    // But after start without stop:
    const c = new AutoSave(makeStore().store);
    c.start();
    const d = new AutoSave(makeStore().store);
    expect(d.isEnabled()).toBe(true);
  });

  it('tick() is a no-op when not dirty', () => {
    const { store } = makeStore();
    const a = new AutoSave(store);
    a.tick();
    expect(AutoSave.loadPending()).toBeNull();
  });

  it('tick() writes a snapshot when dirty', () => {
    const { store, fireDirty } = makeStore();
    const a = new AutoSave(store);
    fireDirty();
    a.tick();
    const pending = AutoSave.loadPending();
    expect(pending).not.toBeNull();
    expect(pending!.projectName).toBe('Untitled Project');
    // Body is JSON-serialized SynthProject.
    const body = JSON.parse(pending!.json);
    expect(body.type).toBe('ruttetra-project');
  });

  it('clearPending() removes the snapshot', () => {
    const { store, fireDirty } = makeStore();
    const a = new AutoSave(store);
    fireDirty();
    a.tick();
    expect(AutoSave.loadPending()).not.toBeNull();
    AutoSave.clearPending();
    expect(AutoSave.loadPending()).toBeNull();
  });

  it('start() runs a tick immediately so enable-then-crash leaves a recoverable snapshot', () => {
    const { store, fireDirty } = makeStore();
    fireDirty(); // dirty before enable
    const a = new AutoSave(store);
    a.start();
    expect(AutoSave.loadPending()).not.toBeNull();
    a.stop();
  });

  describe('formatAge', () => {
    it('reports "less than a minute ago" for very recent', () => {
      const t = new Date(Date.now() - 5_000).toISOString();
      expect(AutoSave.formatAge(t)).toBe('less than a minute ago');
    });

    it('reports minutes / hours / days', () => {
      const min = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(AutoSave.formatAge(min)).toMatch(/minute/);
      const hr = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(AutoSave.formatAge(hr)).toMatch(/hour/);
      const day = new Date(Date.now() - 2 * 86_400_000).toISOString();
      expect(AutoSave.formatAge(day)).toMatch(/day/);
    });

    it('handles invalid input', () => {
      expect(AutoSave.formatAge('not-a-date')).toBe('recently');
    });
  });
});

describe('AutoSave — interval (fake timers)', () => {
  it('writes a snapshot on each interval tick when dirty', () => {
    vi.useFakeTimers();
    try {
      const { store, fireDirty } = makeStore();
      const a = new AutoSave(store);
      a.start();
      AutoSave.clearPending(); // reset post enable-tick

      fireDirty();
      vi.advanceTimersByTime(60_000);
      expect(AutoSave.loadPending()).not.toBeNull();
      a.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
