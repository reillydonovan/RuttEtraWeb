import { describe, it, expect } from 'vitest';
import { PRESETS } from '../../ui/presets';
import { DEFAULTS } from '../Settings';

describe('built-in Default preset', () => {
  const def = PRESETS[0];

  it('is listed first', () => {
    expect(def.id).toBe('default');
    expect(def.name).toBe('Default');
  });

  it('resets every key the other looks change to its factory value', () => {
    for (const p of PRESETS.slice(1)) {
      for (const k of Object.keys(p.values)) {
        if (k.startsWith('pattern')) continue;
        expect(def.values).toHaveProperty(k, (DEFAULTS as unknown as Record<string, unknown>)[k]);
      }
    }
  });

  it('never touches the Pattern Generator (the picture on screen stays on)', () => {
    expect(Object.keys(def.values).some((k) => k.startsWith('pattern'))).toBe(false);
  });
});
