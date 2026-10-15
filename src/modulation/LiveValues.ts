/**
 * Base-vs-live param store.
 *
 * The bug we're fixing: previously, both engines wrote `base + sum` directly
 * back into `Settings`. When a binding/slot was disabled, deleted, or its
 * amount fell to zero, the engine simply stopped writing — so the last
 * modulated value stuck around in `Settings` forever. The renderer kept
 * showing the old wobble even though "no patches are modulating Z Push".
 *
 * Architecture (per the canonical "base + mod" pattern used by every
 * modulation-capable synth):
 *
 *   - `Settings` holds **base values**. The UI knob reads/writes these.
 *     Modulation NEVER touches `Settings`.
 *   - `LiveValuesStore` holds **live values** = `(base + sum_offsets) *
 *     product_factors`. The renderer/shader subscribes here.
 *   - Every engine pushes its current contributions in one shot per frame
 *     via `setContributions(namespace, offsets, factors)`. Contributions
 *     not in the new map are CLEARED for that namespace on the same
 *     frame — there is no stickiness.
 *
 * Both engines (Classic `ModMatrix` and `GraphEngine`) write into separate
 * namespaces ("classic" and "graph"). Their contributions sum/multiply
 * across namespaces, then the live value re-publishes to subscribers.
 *
 * Subscribers are auto-rebroadcast when:
 *   - `Settings.set(key, ...)` fires for a tracked key (user drag).
 *   - Either engine's `setContributions` updates that key's contribution.
 *   - A previously-modulated key's contribution is removed (live snaps
 *     back to base immediately, no lag).
 */

import { Settings, SettingsStore } from '../state/Settings';

type LiveListener = (value: number, key: string) => void;

/**
 * Map | object → Map. Lets engines pass either shape without ceremony.
 */
function toMap<V>(x: Map<string, V> | Record<string, V> | undefined): Map<string, V> {
  if (!x) return new Map();
  if (x instanceof Map) return x;
  return new Map(Object.entries(x));
}

export class LiveValuesStore {
  private settings: SettingsStore;

  /** namespace -> { paramKey -> additive offset } */
  private offsetsByNs = new Map<string, Map<string, number>>();
  /** namespace -> { paramKey -> multiplicative factor (1 = no effect) } */
  private factorsByNs = new Map<string, Map<string, number>>();

  /** paramKey -> set of subscribers */
  private listeners = new Map<string, Set<LiveListener>>();

  /** Keys we've already wired a settings.subscribe for (one per key). */
  private settingsHooked = new Set<string>();

  /**
   * Last live values published per key. Used to decide whether to fire
   * subscribers — we don't want to re-broadcast the same number every
   * frame when nothing changed.
   */
  private lastPublished = new Map<string, number>();

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  /**
   * Replace this namespace's contributions in one call.
   *
   * Keys that were in the previous offsets/factors map but aren't in the
   * new ones are CLEARED — the namespace's contribution to those keys
   * goes to zero this frame. This is the "no stickiness" guarantee that
   * fixes the original bug.
   *
   * Both `offsets` and `factors` can be passed as Map or plain object.
   * Passing `undefined` for a side is equivalent to passing an empty map.
   */
  setContributions(
    namespace: string,
    offsets?: Map<string, number> | Record<string, number>,
    factors?: Map<string, number> | Record<string, number>,
  ): void {
    const nextOffsets = toMap(offsets);
    const nextFactors = toMap(factors);
    const prevOffsets = this.offsetsByNs.get(namespace);
    const prevFactors = this.factorsByNs.get(namespace);

    this.offsetsByNs.set(namespace, nextOffsets);
    this.factorsByNs.set(namespace, nextFactors);

    // Republish every key that was either in the previous or current
    // contribution sets. Keys removed since last frame are republished
    // with their fresh (= base-only) live value, which is what fixes the
    // sticking bug.
    const touched = new Set<string>();
    if (prevOffsets) for (const k of prevOffsets.keys()) touched.add(k);
    if (prevFactors) for (const k of prevFactors.keys()) touched.add(k);
    for (const k of nextOffsets.keys()) touched.add(k);
    for (const k of nextFactors.keys()) touched.add(k);

    for (const k of touched) this.republish(k);
  }

  /**
   * Force re-publish of every currently-modulated key. Called by the
   * "Reset Mod" panic button and by `?debug=mod` so the UI can pull a
   * fresh snapshot on demand.
   */
  republishAll(): void {
    const all = new Set<string>();
    for (const m of this.offsetsByNs.values()) for (const k of m.keys()) all.add(k);
    for (const m of this.factorsByNs.values()) for (const k of m.keys()) all.add(k);
    for (const k of this.listeners.keys()) all.add(k);
    for (const k of all) this.republish(k);
  }

  /** Clear ALL contributions across all namespaces — every modulated
   *  key snaps back to base on the next publish. Equivalent to having
   *  no engines running. Used by "Reset Mod". */
  clearAll(): void {
    const touched = new Set<string>();
    for (const m of this.offsetsByNs.values()) for (const k of m.keys()) touched.add(k);
    for (const m of this.factorsByNs.values()) for (const k of m.keys()) touched.add(k);
    this.offsetsByNs.clear();
    this.factorsByNs.clear();
    for (const k of touched) this.republish(k);
  }

  // -------------------- queries (used by debug overlay) --------------------

  /** Settings-side base value for a key. Falls back to 0 for non-numeric. */
  getBase(key: string): number {
    const v = this.settings.get(key as keyof Settings) as unknown;
    return typeof v === 'number' ? v : 0;
  }

  /** Total additive offset across all namespaces. 0 if unmodulated. */
  getOffset(key: string): number {
    let s = 0;
    for (const m of this.offsetsByNs.values()) s += m.get(key) ?? 0;
    return s;
  }

  /** Additive offset contributed by ONE namespace (0 if none). Lets the
   *  panel slider show "base + timeline offset" as the value at the
   *  playhead without folding in LFO/CV wobble from other namespaces. */
  getNamespaceOffset(namespace: string, key: string): number {
    return this.offsetsByNs.get(namespace)?.get(key) ?? 0;
  }

  /** Total multiplicative factor across all namespaces. 1 if unmodulated. */
  getFactor(key: string): number {
    let f = 1;
    for (const m of this.factorsByNs.values()) f *= m.get(key) ?? 1;
    return f;
  }

  /**
   * Live value: `(base + sum(offsets)) * product(factors)`.
   *
   * A non-finite result (a graph feedback loop with gain > 1 grows to
   * Infinity, then NaN) falls back to the base value instead of reaching
   * the renderer — an Infinity/NaN uniform blanks the whole raster until
   * reload. Warned once per key, not silent (principle 3); the patch keeps
   * running and recovers from base on the next frame.
   */
  getLive(key: string): number {
    const v = (this.getBase(key) + this.getOffset(key)) * this.getFactor(key);
    if (Number.isFinite(v)) return v;
    if (!this.warnedNonFinite.has(key)) {
      this.warnedNonFinite.add(key);
      console.warn(`[mod] "${key}" modulated to a non-finite value (runaway feedback?) — holding it at base`);
    }
    return this.getBase(key);
  }
  private readonly warnedNonFinite = new Set<string>();

  /** Modulation magnitude `live - base` (signed). */
  getMod(key: string): number {
    return this.getLive(key) - this.getBase(key);
  }

  /** Set of every key that currently has a non-zero contribution from
   *  any namespace. Used by the debug overlay. */
  modulatedKeys(): Set<string> {
    const all = new Set<string>();
    for (const m of this.offsetsByNs.values()) for (const k of m.keys()) all.add(k);
    for (const m of this.factorsByNs.values()) for (const k of m.keys()) all.add(k);
    return all;
  }

  // -------------------- subscribe / publish --------------------

  /**
   * Subscribe to live-value changes for `key`. Replaces the old
   * `settings.subscribe(key, ...)` for any modulatable param — fires on
   * EITHER user-drag (settings change) OR engine push (modulation change).
   *
   * Fires once immediately with the current live value.
   */
  subscribe(key: string, fn: LiveListener): () => void {
    let set = this.listeners.get(key);
    if (!set) { set = new Set(); this.listeners.set(key, set); }
    set.add(fn);

    if (!this.settingsHooked.has(key)) {
      this.settingsHooked.add(key);
      this.settings.subscribe(key as keyof Settings, () => this.republish(key));
    }

    fn(this.getLive(key), key);
    return () => set!.delete(fn);
  }

  /** Recompute and publish a single key. */
  republish(key: string): void {
    const set = this.listeners.get(key);
    if (!set || set.size === 0) {
      this.lastPublished.set(key, this.getLive(key));
      return;
    }
    const live = this.getLive(key);
    const prev = this.lastPublished.get(key);
    if (prev !== undefined && Object.is(prev, live)) return;
    this.lastPublished.set(key, live);
    for (const fn of set) fn(live, key);
  }
}
