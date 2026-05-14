import { describe, expect, it } from 'vitest';
import { runNode } from './helpers';

describe('joystick-x/y/z', () => {
  it('reads ctx.joystick directly', () => {
    expect(runNode('joystick-x', 1, { joystick: { x: 0.42, y: 0, z: 0 } }).out).toBe(0.42);
    expect(runNode('joystick-y', 1, { joystick: { x: 0, y: -0.5, z: 0 } }).out).toBe(-0.5);
    expect(runNode('joystick-z', 1, { joystick: { x: 0, y: 0, z: 1 } }).out).toBe(1);
  });
});

describe('midi-cc', () => {
  it('returns 0 when no midi mapping', () => {
    expect(runNode('midi-cc', 1).out).toBe(0);
  });
  it('reads getRawCC and applies bipolar', () => {
    const mapping = {
      getRawCC: (_ch: number, _cc: number) => 0.5,
      getPoly: () => ({ lastNote: null, lastVelocity: 0 }),
    };
    expect(runNode('midi-cc', 1, { deps: { midiMapping: mapping } }).out).toBe(0.5);
    expect(runNode('midi-cc', 1, {
      deps: { midiMapping: mapping }, params: { bipolar: true },
    }).out).toBe(0);
  });
});

describe('midi-note', () => {
  it('outputs normalized pitch and velocity', () => {
    const mapping = {
      getRawCC: () => 0,
      getPoly: () => ({ lastNote: 64, lastVelocity: 100 }),
    };
    const o = runNode('midi-note', 1, { deps: { midiMapping: mapping } });
    expect(o.pitch).toBeCloseTo(64 / 127);
    expect(o.velocity).toBeCloseTo(100 / 127);
  });
  it('returns 0/0 when no note has been played', () => {
    const mapping = {
      getRawCC: () => 0,
      getPoly: () => ({ lastNote: null, lastVelocity: 0 }),
    };
    const o = runNode('midi-note', 1, { deps: { midiMapping: mapping } });
    expect(o.pitch).toBe(0);
    expect(o.velocity).toBe(0);
  });
});

describe('osc-in', () => {
  it('returns 0 when no osc client', () => {
    expect(runNode('osc-in', 1).out).toBe(0);
  });
  it('reads getMostRecent', () => {
    const osc = { getMostRecent: () => 0.7 };
    expect(runNode('osc-in', 1, { deps: { osc } }).out).toBeCloseTo(0.7);
  });
});
