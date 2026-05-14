import { describe, expect, it, beforeEach } from 'vitest';
import { maybePackageRecoveredSession } from '../RecoveredSession';

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
});

describe('RecoveredSession — first-launch packaging', () => {
  it('does nothing on a clean install', () => {
    const did = maybePackageRecoveredSession();
    expect(did).toBe(false);
    // Flag is still set so subsequent boots don't re-check.
    expect(localStorage.getItem('ruttetra.project.recoveredAt')).not.toBeNull();
    expect(localStorage.getItem('ruttetra.project.autosave.v1')).toBeNull();
  });

  it('packages legacy settings into a recovery snapshot', () => {
    localStorage.setItem('ruttetra.settings.v1', JSON.stringify({
      _v: 9, threshold: 0.42,
    }));

    const did = maybePackageRecoveredSession();
    expect(did).toBe(true);

    const payload = JSON.parse(localStorage.getItem('ruttetra.project.autosave.v1')!);
    expect(payload.projectName).toBe('Recovered Session');
    const project = JSON.parse(payload.json);
    expect(project.type).toBe('ruttetra-project');
    expect(project.name).toBe('Recovered Session');
    expect((project.settings as { threshold: number }).threshold).toBe(0.42);
  });

  it('packages legacy user presets', () => {
    localStorage.setItem('ruttetra.userPresets.v1', JSON.stringify([
      { id: 'p1', name: 'Old Preset', values: { contrast: 1.5 } },
    ]));
    expect(maybePackageRecoveredSession()).toBe(true);
    const payload = JSON.parse(localStorage.getItem('ruttetra.project.autosave.v1')!);
    const project = JSON.parse(payload.json);
    expect(project.userPresets).toHaveLength(1);
    expect(project.userPresets[0].name).toBe('Old Preset');
  });

  it('packages legacy timelines', () => {
    localStorage.setItem('ruttetra.timelines.v1', JSON.stringify([
      { _v: 1, id: 'tl', name: 'Old Timeline', beatsPerBar: 4, lengthBars: 8, loop: true, syncMode: 'internal', excludedParams: [], keyframes: [] },
    ]));
    expect(maybePackageRecoveredSession()).toBe(true);
    const payload = JSON.parse(localStorage.getItem('ruttetra.project.autosave.v1')!);
    const project = JSON.parse(payload.json);
    expect(project.timelines).toHaveLength(1);
    expect(project.timelines[0].id).toBe('tl');
  });

  it('does not re-package on second boot (one-shot)', () => {
    localStorage.setItem('ruttetra.settings.v1', JSON.stringify({ _v: 9 }));
    expect(maybePackageRecoveredSession()).toBe(true);
    // Clear the recovery payload so we can detect re-packaging.
    localStorage.removeItem('ruttetra.project.autosave.v1');
    expect(maybePackageRecoveredSession()).toBe(false);
    expect(localStorage.getItem('ruttetra.project.autosave.v1')).toBeNull();
  });

  it('does NOT clobber an existing pending auto-save', () => {
    const existing = JSON.stringify({ writtenAt: '2026-01-01', projectName: 'Mine', json: '{}' });
    localStorage.setItem('ruttetra.project.autosave.v1', existing);
    localStorage.setItem('ruttetra.settings.v1', JSON.stringify({ _v: 9 }));
    expect(maybePackageRecoveredSession()).toBe(false);
    expect(localStorage.getItem('ruttetra.project.autosave.v1')).toBe(existing);
  });

  it('handles malformed legacy JSON without throwing', () => {
    localStorage.setItem('ruttetra.settings.v1', '{ this is not json');
    localStorage.setItem('ruttetra.userPresets.v1', '###');
    expect(() => maybePackageRecoveredSession()).not.toThrow();
  });
});
