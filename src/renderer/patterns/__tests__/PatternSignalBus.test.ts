import { describe, expect, it } from 'vitest';
import { PatternSignalBus } from '../PatternSignalBus';

describe('PatternSignalBus', () => {
  it('id() composes kind + signal with a colon separator', () => {
    expect(PatternSignalBus.id('lissajous', 'x')).toBe('lissajous:x');
    expect(PatternSignalBus.id('sineBands', 'wave')).toBe('sineBands:wave');
    expect(PatternSignalBus.id('oscilloscope', 'mean')).toBe('oscilloscope:mean');
  });

  it('starts empty and returns 0 for unknown ids', () => {
    const bus = new PatternSignalBus();
    expect(bus.get('lissajous:x')).toBe(0);
    expect(bus.has('lissajous:x')).toBe(false);
  });

  it('set() / get() round-trips a finite number', () => {
    const bus = new PatternSignalBus();
    bus.set('lissajous:x', 0.5);
    expect(bus.get('lissajous:x')).toBe(0.5);
    expect(bus.has('lissajous:x')).toBe(true);

    bus.set('lissajous:x', -0.7);
    expect(bus.get('lissajous:x')).toBe(-0.7);
  });

  it('set() coerces NaN / Infinity / non-finite values to 0', () => {
    const bus = new PatternSignalBus();
    bus.set('a', Number.NaN);
    bus.set('b', Number.POSITIVE_INFINITY);
    bus.set('c', Number.NEGATIVE_INFINITY);
    expect(bus.get('a')).toBe(0);
    expect(bus.get('b')).toBe(0);
    expect(bus.get('c')).toBe(0);
    // The coerced values still register as "set" — readers can
    // distinguish "explicitly zero" from "never written" via has().
    expect(bus.has('a')).toBe(true);
  });

  it('clear() drops every published signal', () => {
    const bus = new PatternSignalBus();
    bus.set('lissajous:x', 0.3);
    bus.set('sineBands:wave', -0.4);
    bus.clear();
    expect(bus.has('lissajous:x')).toBe(false);
    expect(bus.has('sineBands:wave')).toBe(false);
    expect(bus.get('lissajous:x')).toBe(0);
  });

  it('entries() yields every set value', () => {
    const bus = new PatternSignalBus();
    bus.set('a', 1);
    bus.set('b', 2);
    const seen = Object.fromEntries(bus.entries());
    expect(seen).toEqual({ a: 1, b: 2 });
  });
});
