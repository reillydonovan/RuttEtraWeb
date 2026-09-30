import { describe, expect, it, vi } from 'vitest';
import { snapshotProject, applyProject, presetFromProject } from '../Project';
import { PROJECT_TYPE_TAG, SynthProject } from '../types';
import { SettingsStore, SETTINGS_VERSION } from '../../state/Settings';

function applyDeps(settings: SettingsStore) {
  return { settings, setUserPresets: () => {}, setTimelines: () => {} };
}

function projectWith(settings: Record<string, unknown>): SynthProject {
  return {
    formatVersion: 1, type: PROJECT_TYPE_TAG, appVersion: 'x',
    savedAt: new Date().toISOString(), name: 'p',
    settings: settings as SynthProject['settings'],
    userPresets: [], timelines: [],
  };
}

describe('Project — launch hardening', () => {
  it('snapshots are stamped with the settings schema version and carry no WHIP token', () => {
    const settings = new SettingsStore();
    settings.set('whipBearerToken', 'secret');
    const p = snapshotProject({ settings, getUserPresets: () => [], getTimelines: () => [] }, { name: 'x' });
    expect((p.settings as Record<string, unknown>)._v).toBe(SETTINGS_VERSION);
    expect(p.settings).not.toHaveProperty('whipBearerToken');
    expect(presetFromProject(projectWith({ whipBearerToken: 'secret', contrast: 1 }))).not.toHaveProperty('whipBearerToken');
  });

  it('a saved project reopens with its layout intact (no re-run of old migration steps)', () => {
    const a = new SettingsStore();
    a.set('timelineDock', 'top');
    const p = snapshotProject({ settings: a, getUserPresets: () => [], getTimelines: () => [] }, { name: 'x' });
    const b = new SettingsStore();
    applyProject(JSON.parse(JSON.stringify(p)), applyDeps(b));
    expect(b.get('timelineDock')).toBe('top');
  });

  it('a project file cannot switch on the MCP bridge or aim it off this network', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const settings = new SettingsStore();
    const before = settings.get('mcpBridgeUrl');
    applyProject(projectWith({
      _v: SETTINGS_VERSION, mcpAutoConnect: true, mcpBridgeUrl: 'wss://evil.example/relay',
      oscAutoConnect: true, contrast: 1.3,
    }), applyDeps(settings));
    expect(settings.get('mcpAutoConnect')).toBe(false);
    expect(settings.get('oscAutoConnect')).toBe(false);
    expect(settings.get('mcpBridgeUrl')).toBe(before);
    expect(settings.get('contrast')).toBe(1.3);
    warn.mockRestore();
  });
});
