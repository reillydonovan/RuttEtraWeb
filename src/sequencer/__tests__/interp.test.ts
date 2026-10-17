import { describe, it, expect } from 'vitest';
import { lerpSnapshot } from '../interp';
import { PHOSPHOR_AMBER_HEX, PHOSPHOR_GREEN_HEX } from '../../state/colorModes';
import type { Settings } from '../../state/Settings';

const none = new Set<string>();
const green: Partial<Settings> = { colorMode: 'phosphorGreen', customTint: '#123456' };
const amber: Partial<Settings> = { colorMode: 'phosphorAmber', customTint: '#abcdef' };

describe('lerpSnapshot — Color Mode crossfade', () => {
  it('glides green → amber through a blended custom tint', () => {
    const mid = lerpSnapshot(green, amber, 0.5, none);
    expect(mid.colorMode).toBe('phosphorCustom');
    // halfway between #5fff85 and #ffb347
    expect(mid.customTint).toBe('#afd966');
  });

  it('lands exactly on each end', () => {
    const a = lerpSnapshot(green, amber, 0, none);
    expect(a.colorMode).toBe('phosphorGreen');
    expect(a.customTint).toBe('#123456');
    const b = lerpSnapshot(green, amber, 1, none);
    expect(b.colorMode).toBe('phosphorAmber');
    expect(b.customTint).toBe('#abcdef');
  });

  it('starts from the A tint and approaches the B tint', () => {
    expect(lerpSnapshot(green, amber, 0.001, none).customTint).toBe(PHOSPHOR_GREEN_HEX);
    expect(lerpSnapshot(green, amber, 0.999, none).customTint).toBe(PHOSPHOR_AMBER_HEX);
  });

  it('uses the custom tint of a Custom-mode end', () => {
    const custom: Partial<Settings> = { colorMode: 'phosphorCustom', customTint: '#0000ff' };
    expect(lerpSnapshot({ colorMode: 'grayscale', customTint: '#0000ff' }, custom, 0.5, none).customTint).toBe('#8080ff');
  });

  it('still steps to or from Video colour (no tint to blend)', () => {
    const video: Partial<Settings> = { colorMode: 'video', customTint: '#123456' };
    expect(lerpSnapshot(green, video, 0.4, none).colorMode).toBe('phosphorGreen');
    expect(lerpSnapshot(green, video, 0.6, none).colorMode).toBe('video');
  });

  it('respects excluded keys', () => {
    const out = lerpSnapshot(green, amber, 0.5, new Set(['colorMode']));
    expect(out.colorMode).toBeUndefined();
  });

  it('omits unchanged values against prevApplied', () => {
    const first = lerpSnapshot(green, amber, 0.5, none);
    const again = lerpSnapshot(green, amber, 0.5, none, first);
    expect(again).not.toHaveProperty('colorMode');
    expect(again).not.toHaveProperty('customTint');
  });
});
