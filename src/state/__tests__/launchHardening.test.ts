import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULTS, SETTINGS_VERSION, SettingsStore, migrateSettings, presetPatch,
  sanitizeImportedSettings, settingsSnapshot, isLocalBridgeUrl, stripExportSecrets,
} from '../Settings';
import { PRESETS, NO_CAMERA_PRESET_ID } from '../../ui/presets';

describe('presetPatch (built-in presets)', () => {
  it('patches ONLY the keys a preset names — never bindings, graph, layout or the dock', () => {
    for (const p of PRESETS) {
      const patch = presetPatch(p.values) as Record<string, unknown>;
      expect(Object.keys(patch).sort()).toEqual(Object.keys(p.values).sort());
      for (const k of ['midiBindings', 'oscBindings', 'modGraph', 'modMode', 'workspaceTabs', 'timelineDock']) {
        if (!(k in p.values)) expect(patch).not.toHaveProperty(k);
      }
    }
  });

  it('leaves unrelated live state intact when applied to a store', () => {
    const s = new SettingsStore();
    s.set('timelineDock', 'top');
    s.set('patternEnabled', true);
    const classic = PRESETS.find((p) => p.id === 'classic-1974')!;
    s.patch(presetPatch(classic.values));
    expect(s.get('timelineDock')).toBe('top');
    expect(s.get('patternEnabled')).toBe(true);
    expect(s.get('colorMode')).toBe('grayscale');
  });

  it('every built-in preset key exists in DEFAULTS with a matching type', () => {
    const defaults = DEFAULTS as unknown as Record<string, unknown>;
    for (const p of PRESETS) {
      for (const [k, v] of Object.entries(p.values)) {
        expect(defaults, `${p.id}.${k}`).toHaveProperty(k);
        expect(typeof v, `${p.id}.${k}`).toBe(typeof defaults[k]);
      }
    }
  });

  it('the no-camera preset turns the Pattern Generator on with a moving pattern', () => {
    const p = PRESETS.find((x) => x.id === NO_CAMERA_PRESET_ID)!;
    const patch = presetPatch(p.values);
    expect(patch.patternEnabled).toBe(true);
    expect(['perlinNoise', 'worleyNoise', 'lissajous', 'whiteNoise']).toContain(patch.patternKind);
  });
});

describe('import safety', () => {
  it('ignores auto-connect flags and the WHIP token from a file', () => {
    const out = sanitizeImportedSettings({
      mcpAutoConnect: true, oscAutoConnect: true, whipBearerToken: 'secret', contrast: 1.2,
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('mcpAutoConnect');
    expect(out).not.toHaveProperty('oscAutoConnect');
    expect(out).not.toHaveProperty('whipBearerToken');
    expect(out.contrast).toBe(1.2);
  });

  it('keeps local bridge URLs and drops remote ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = sanitizeImportedSettings({ mcpBridgeUrl: 'ws://localhost:57132', oscBridgeUrl: 'ws://192.168.1.20:8080' });
    expect(local).toEqual({ mcpBridgeUrl: 'ws://localhost:57132', oscBridgeUrl: 'ws://192.168.1.20:8080' });
    const remote = sanitizeImportedSettings({ mcpBridgeUrl: 'wss://evil.example/x', oscBridgeUrl: 'ws://8.8.8.8:8080' });
    expect(remote).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('isLocalBridgeUrl covers loopback, private ranges and rejects the rest', () => {
    for (const u of ['ws://localhost:1', 'ws://127.0.0.1:1', 'ws://[::1]:1', 'ws://10.0.0.5:1', 'ws://172.20.1.1:1',
      'ws://192.168.0.2:1', 'ws://studio.local:1', 'wss://127.0.0.1:1']) {
      expect(isLocalBridgeUrl(u), u).toBe(true);
    }
    for (const u of ['ws://8.8.8.8:1', 'wss://ruttetraweb.com/x', 'ws://172.32.0.1:1', 'http://localhost:1', 'nonsense', 42]) {
      expect(isLocalBridgeUrl(u), String(u)).toBe(false);
    }
  });

  it('SettingsStore.import keeps the current connection settings instead of resetting them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SettingsStore();
    s.set('mcpBridgeUrl', 'ws://127.0.0.1:60000');
    s.import(JSON.stringify({ _v: SETTINGS_VERSION, mcpBridgeUrl: 'wss://evil.example', mcpAutoConnect: true, contrast: 1.4 }));
    expect(s.get('mcpBridgeUrl')).toBe('ws://127.0.0.1:60000');
    expect(s.get('mcpAutoConnect')).toBe(false);
    expect(s.get('contrast')).toBe(1.4);
    warn.mockRestore();
  });
});

describe('snapshots are stamped and secret-free', () => {
  it('settingsSnapshot stamps _v and strips the WHIP token', () => {
    const s = new SettingsStore();
    s.set('whipBearerToken', 'secret');
    const snap = settingsSnapshot(s.all) as Record<string, unknown>;
    expect(snap._v).toBe(SETTINGS_VERSION);
    expect(snap).not.toHaveProperty('whipBearerToken');
    expect(JSON.parse(s.export())).not.toHaveProperty('whipBearerToken');
  });

  it('stripExportSecrets does not mutate its input', () => {
    const src = { whipBearerToken: 'x', contrast: 1 };
    stripExportSecrets(src);
    expect(src.whipBearerToken).toBe('x');
  });

  it('a stamped full snapshot migrates without re-running old layout steps', () => {
    const s = new SettingsStore();
    s.set('timelineDock', 'top');
    const migrated = migrateSettings(settingsSnapshot(s.all)) as Record<string, unknown>;
    expect(migrated.timelineDock).toBe('top');
  });
});

describe('migrateSettings type guard', () => {
  it('drops values whose type disagrees with DEFAULTS and reports them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = migrateSettings({ _v: SETTINGS_VERSION, cols: 'banana', contrast: Number.NaN, threshold: 0.3, midiBindings: {} }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('cols');
    expect(out).not.toHaveProperty('contrast');
    expect(out).not.toHaveProperty('midiBindings');
    expect(out.threshold).toBe(0.3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('DEFAULTS pass through untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = migrateSettings({ ...DEFAULTS, _v: SETTINGS_VERSION }) as Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS)) expect(out, k).toHaveProperty(k);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns on a snapshot from a newer build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    migrateSettings({ _v: SETTINGS_VERSION + 1 });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('newer') || String(c[0]).includes(`v${SETTINGS_VERSION + 1}`))).toBe(true);
    warn.mockRestore();
  });
});
