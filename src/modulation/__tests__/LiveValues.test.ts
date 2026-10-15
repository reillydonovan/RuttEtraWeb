/**
 * LiveValuesStore tests.
 *
 * Pins down the contract that the renderer relies on:
 *   - Subscribers get the current live value on register.
 *   - When `Settings` changes, subscribers re-fire with new live value.
 *   - When an engine pushes contributions, subscribers re-fire.
 *   - Removing a key from a namespace's contributions snaps live=back to
 *     base IMMEDIATELY (no one-frame lag, no stickiness — this is the
 *     core guarantee of the bug fix).
 *   - Multiple namespaces sum their offsets and multiply their factors.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { LiveValuesStore } from '../LiveValues';

class FakeStore {
  state: Record<string, number> = {};
  private listeners = new Map<string, Set<(v: unknown, k: unknown) => void>>();
  get(key: string): unknown { return this.state[key]; }
  set(key: string, v: unknown): void {
    if (Object.is(this.state[key], v)) return;
    this.state[key] = v as number;
    const set = this.listeners.get(key);
    if (set) for (const fn of set) fn(v, key);
  }
  subscribe(key: string, fn: (v: unknown, k: unknown) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) { set = new Set(); this.listeners.set(key, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }
}

describe('LiveValuesStore', () => {
  let store: FakeStore;
  let live: LiveValuesStore;

  beforeEach(() => {
    store = new FakeStore();
    store.state.zPush = 0.5;
    store.state.intensity = 1;
    live = new LiveValuesStore(store as unknown as never);
  });

  it('subscribe fires immediately with base value', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    expect(last).toBe(0.5);
  });

  it('settings change re-publishes live value', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    store.set('zPush', 0.9);
    expect(last).toBe(0.9);
  });

  it('a non-finite contribution (runaway feedback) holds the live value at base', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    live.setContributions('graph', { zPush: Infinity });
    expect(last).toBe(0.5);
    expect(live.getLive('zPush')).toBe(0.5);
    live.setContributions('graph', { zPush: NaN });
    expect(live.getLive('zPush')).toBe(0.5);
    live.setContributions('graph', { zPush: 0.25 });
    expect(live.getLive('zPush')).toBeCloseTo(0.75);
  });

  it('engine offset adds to live but leaves base alone', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    live.setContributions('classic', { zPush: 0.3 });
    expect(last).toBeCloseTo(0.8);
    expect(store.state.zPush).toBe(0.5);
    expect(live.getBase('zPush')).toBe(0.5);
    expect(live.getMod('zPush')).toBeCloseTo(0.3);
  });

  it('removing offset snaps live back to base on the same call', () => {
    const events: number[] = [];
    live.subscribe('zPush', (v) => events.push(v));
    live.setContributions('classic', { zPush: 0.3 });
    live.setContributions('classic', {}); // <-- the bug fix
    expect(events).toEqual([0.5, 0.8, 0.5]);
    expect(live.getMod('zPush')).toBe(0);
  });

  it('amount=0 contribution publishes base value (no stickiness)', () => {
    const events: number[] = [];
    live.subscribe('zPush', (v) => events.push(v));
    live.setContributions('classic', { zPush: 0.3 });
    live.setContributions('classic', { zPush: 0 }); // amount drops to 0
    expect(events).toEqual([0.5, 0.8, 0.5]);
  });

  it('multiple namespaces sum additive offsets', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    live.setContributions('classic', { zPush: 0.1 });
    live.setContributions('graph',   { zPush: 0.2 });
    expect(last).toBeCloseTo(0.5 + 0.1 + 0.2);
  });

  it('clearing one namespace leaves the other intact', () => {
    let last = -1;
    live.subscribe('zPush', (v) => { last = v; });
    live.setContributions('classic', { zPush: 0.1 });
    live.setContributions('graph',   { zPush: 0.2 });
    live.setContributions('classic', {}); // mute classic only
    expect(last).toBeCloseTo(0.7); // base + graph still there
  });

  it('multiplicative factors multiply the (base + offset) sum', () => {
    let last = -1;
    live.subscribe('intensity', (v) => { last = v; });
    live.setContributions('graph', {}, { intensity: 1.5 });
    expect(last).toBeCloseTo(1.5);
  });

  it('clearAll() drops every namespace and restores live=base', () => {
    const events: number[] = [];
    live.subscribe('zPush', (v) => events.push(v));
    live.setContributions('classic', { zPush: 0.4 });
    live.setContributions('graph',   { zPush: 0.2 });
    live.clearAll();
    expect(events.at(-1)).toBe(0.5);
    expect(live.getMod('zPush')).toBe(0);
  });

  it('user-drag updates settings → live republishes with new base + same mod', () => {
    const events: number[] = [];
    live.subscribe('zPush', (v) => events.push(v));
    live.setContributions('classic', { zPush: 0.2 });
    expect(events.at(-1)).toBeCloseTo(0.7);
    store.set('zPush', 0.9); // user drags slider mid-modulation
    expect(events.at(-1)).toBeCloseTo(1.1); // 0.9 base + 0.2 mod
  });

  it('subscribe with no listeners on the key is a no-op publish (no error)', () => {
    expect(() => live.setContributions('classic', { zPush: 0.5 })).not.toThrow();
  });

  it('getOffset / getFactor / getLive return current values', () => {
    live.setContributions('classic', { zPush: 0.1 });
    live.setContributions('graph',   { zPush: 0.2 }, { zPush: 1.5 });
    expect(live.getOffset('zPush')).toBeCloseTo(0.3);
    expect(live.getFactor('zPush')).toBeCloseTo(1.5);
    expect(live.getLive('zPush')).toBeCloseTo((0.5 + 0.3) * 1.5);
  });

  it('getNamespaceOffset isolates one namespace (slider playhead display)', () => {
    live.setContributions('timeline', { zPush: 2.0 });
    live.setContributions('classic',  { zPush: 0.3 });
    expect(live.getNamespaceOffset('timeline', 'zPush')).toBeCloseTo(2.0);
    expect(live.getNamespaceOffset('classic',  'zPush')).toBeCloseTo(0.3);
    expect(live.getNamespaceOffset('graph',    'zPush')).toBe(0);
    // Clearing the namespace zeroes its isolated offset immediately.
    live.setContributions('timeline', {});
    expect(live.getNamespaceOffset('timeline', 'zPush')).toBe(0);
  });
});
