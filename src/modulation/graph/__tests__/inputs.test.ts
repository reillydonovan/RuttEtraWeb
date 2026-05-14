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

describe('cv-input', () => {
  it('returns 0 when no cv reader', () => {
    expect(runNode('cv-input', 1).out).toBe(0);
  });
  it('returns 0 when cv is not running', () => {
    const cv = {
      getNormalized: () => 0.5, getVoltage: () => 2.5, getVariance: () => 0,
      running: false, channelCount: 0,
    };
    expect(runNode('cv-input', 1, { deps: { cv } }).out).toBe(0);
  });
  it('reads getNormalized when running (audio route)', () => {
    const cv = {
      getNormalized: (ch: number) => ch === 1 ? 0.42 : 0,
      getVoltage: () => 2.1, getVariance: () => 0,
      running: true, channelCount: 4,
    };
    expect(runNode('cv-input', 1, { deps: { cv }, params: { route: 'audio', channel: 1 } }).out)
      .toBeCloseTo(0.42);
  });
  it('reads from osc bridge when route=osc', () => {
    const osc = {
      getMostRecent: () => 0,
      getByAddress: (addr: string) => addr === '/cv/3' ? 0.75 : 0,
    };
    // bipolar default → (0.75 * 2 - 1) = 0.5
    const out = runNode('cv-input', 1, {
      deps: { osc }, params: { route: 'osc', channel: 2, bipolar: true },
    }).out;
    expect(out).toBeCloseTo(0.5);
  });
  it('clamps wild values to -1..1', () => {
    const cv = {
      getNormalized: () => 99, getVoltage: () => 0, getVariance: () => 0,
      running: true, channelCount: 1,
    };
    expect(runNode('cv-input', 1, { deps: { cv }, params: { route: 'audio', channel: 0 } }).out)
      .toBe(1);
  });
});

describe('gamepad-axis / gamepad-button', () => {
  it('axis returns 0 when no gamepad', () => {
    expect(runNode('gamepad-axis', 1).out).toBe(0);
  });
  it('axis reads getAxis(idx)', () => {
    const gamepad = {
      getAxis: (i: number) => i === 2 ? 0.6 : 0,
      getButton: () => 0,
      getAxisVariance: () => 0,
    };
    expect(runNode('gamepad-axis', 1, { deps: { gamepad }, params: { axis: 2 } }).out)
      .toBeCloseTo(0.6);
  });
  it('button returns 0..1 by default; gate fires above 0.5', () => {
    const gamepad = {
      getAxis: () => 0,
      getButton: (i: number) => i === 0 ? 0.8 : 0,
      getAxisVariance: () => 0,
    };
    const o = runNode('gamepad-button', 1, { deps: { gamepad }, params: { button: 0 } });
    expect(o.out).toBeCloseTo(0.8);
    expect(o.gate).toBe(1);
  });
  it('button bipolar maps 0..1 to -1..1', () => {
    const gamepad = {
      getAxis: () => 0,
      getButton: () => 1,
      getAxisVariance: () => 0,
    };
    const o = runNode('gamepad-button', 1, { deps: { gamepad }, params: { button: 0, bipolar: true } });
    expect(o.out).toBe(1);
  });
});

describe('cv-output (sink node)', () => {
  it('writes its input to ctx.deps.cvOut.setGraphSource at the configured channel', () => {
    const calls: Array<{ ch: number; v: number }> = [];
    const cvOut = {
      setGraphSource: (ch: number, v: number) => calls.push({ ch, v }),
    };
    runNode('cv-output', 1, {
      deps: { cvOut },
      inputs: { signal: 0.42 },
      params: { channel: 3 },
    });
    expect(calls).toEqual([{ ch: 3, v: 0.42 }]);
  });
  it('no-ops when cvOut dep is missing (does not throw)', () => {
    expect(() => runNode('cv-output', 1, { inputs: { signal: 1 } })).not.toThrow();
  });
  it('floors negative channel indices to 0', () => {
    const calls: Array<{ ch: number; v: number }> = [];
    const cvOut = { setGraphSource: (ch: number, v: number) => calls.push({ ch, v }) };
    runNode('cv-output', 1, {
      deps: { cvOut },
      inputs: { signal: 0.7 },
      params: { channel: -5 },
    });
    expect(calls[0].ch).toBe(0);
  });
  it('skips non-finite signal values', () => {
    const calls: Array<{ ch: number; v: number }> = [];
    const cvOut = { setGraphSource: (ch: number, v: number) => calls.push({ ch, v }) };
    runNode('cv-output', 1, {
      deps: { cvOut },
      inputs: { signal: NaN },
      params: { channel: 1 },
    });
    expect(calls).toHaveLength(0);
  });
});
