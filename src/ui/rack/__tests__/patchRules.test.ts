import { describe, expect, it } from 'vitest';
import { rejectReason, type JackKind } from '../patchRules';

describe('rejectReason', () => {
  it('explains output→output and input→input', () => {
    expect(rejectReason('slot-out', 'param-out')).toMatch(/Both ends are outputs/);
    expect(rejectReason('param-out', 'node-out')).toMatch(/Both ends are outputs/);
    expect(rejectReason('param-in', 'param-in')).toMatch(/Both ends are inputs/);
    expect(rejectReason('node-in', 'param-in')).toMatch(/Both ends are inputs/);
  });

  it('keeps video and control signals apart, both directions', () => {
    expect(rejectReason('video-out', 'param-in')).toMatch(/Video cables only connect video jacks/);
    expect(rejectReason('slot-out', 'video-in')).toMatch(/video jack/);
  });

  it('explains waveform (SOURCES bus) rules', () => {
    expect(rejectReason('bus', 'param-in')).toMatch(/SOURCES jacks pick a waveform/);
    expect(rejectReason('slot-srcin', 'param-out')).toMatch(/takes a waveform from the SOURCES bus/);
    expect(rejectReason('param-out', 'shape')).toMatch(/SRC IN and shape jacks take a waveform/);
    expect(rejectReason('slot-out', 'bus')).toMatch(/waveform outputs/);
  });

  it('refuses self-modulation', () => {
    expect(rejectReason('param-out', 'param-in', { sameParam: true })).toMatch(/can’t modulate itself/);
  });

  it('explains video routing limits', () => {
    expect(rejectReason('video-out', 'video-in', { fromKey: 'dualraster-out', toKey: 'composite-inA' }))
      .toMatch(/only go to the Renderer/);
    expect(rejectReason('video-out', 'video-in', { fromKey: 'dualraster-out', toKey: 'dualraster-inB' }))
      .toMatch(/Dual Raster can’t feed its own input/);
    expect(rejectReason('video-in', 'video-out', { fromKey: 'composite-inB', toKey: 'composite-out' }))
      .toMatch(/Composite can’t feed its own input/);
    expect(rejectReason('video-out', 'video-out')).toMatch(/Both ends are outputs/);
  });

  it('explains Function Generator → graph node input', () => {
    expect(rejectReason('slot-out', 'node-in')).toMatch(/Function Generators drive parameters/);
  });

  it('explains moving a parameter binding onto a node input', () => {
    expect(rejectReason('node-out', 'node-in', { bindingReroute: true })).toMatch(/drop it on a parameter’s input/);
  });

  it('always returns a non-empty sentence for every pair', () => {
    const kinds: JackKind[] = ['param-in', 'param-out', 'slot-out', 'slot-srcin', 'shape', 'bus', 'node-in', 'node-out', 'video-in', 'video-out'];
    for (const a of kinds) for (const b of kinds) {
      const r = rejectReason(a, b);
      expect(r.length, `${a}->${b}`).toBeGreaterThan(10);
      expect(r.endsWith('.'), `${a}->${b}`).toBe(true);
    }
  });
});
