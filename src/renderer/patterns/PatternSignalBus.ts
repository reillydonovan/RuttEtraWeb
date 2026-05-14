/**
 * Pattern Signal Bus — per-frame value store for the modulation signals
 * that pattern generators publish *back into* the modulation system.
 *
 * Every pattern can declare one or more "outputs" (declared in
 * `PatternRegistry.PatternDef.outputs`). On each frame the pattern's
 * CPU-side `compute()` function — which mirrors the shader's math —
 * is called with the current live (modulated) param values, and the
 * results are written here keyed by `<patternKind>:<signalId>`
 * (e.g. `'lissajous:x'`).
 *
 * Three consumers read from the bus:
 *   - ModMatrix's `'patternOutput'` source kind   (Classic mode)
 *   - Graph engine's `pattern-output` node       (Graph mode)
 *   - CVOutput's `'pattern-output'` source kind  (drive hardware modular)
 *
 * The bus is a tiny `Map<string, number>` — no events, no subscribers.
 * Consumers poll once per frame (matches the existing
 * `LiveValuesStore.getLive`-each-frame pattern). Values that haven't
 * been published this session read as 0.
 *
 * Lifecycle:
 *   - `PatternRenderer.tick()` writes values for the active pattern.
 *   - When `patternEnabled` is OFF or `patternKind` changes, the
 *     renderer calls `clear()` so stale signals don't drive params.
 *
 * No three.js, no DOM — keeps this module trivially testable.
 */

export class PatternSignalBus {
  private values = new Map<string, number>();

  /**
   * Compose a fully-qualified signal id from a pattern kind + the
   * pattern-local signal id (e.g. `id('lissajous', 'x')` → `'lissajous:x'`).
   * Centralized so consumers and the renderer don't drift on the format.
   */
  static id(patternKind: string, signal: string): string {
    return `${patternKind}:${signal}`;
  }

  /** Write a single signal value. Non-finite values are coerced to 0. */
  set(id: string, v: number): void {
    if (!Number.isFinite(v)) v = 0;
    this.values.set(id, v);
  }

  /** Read a signal. Unknown ids return 0. */
  get(id: string): number {
    return this.values.get(id) ?? 0;
  }

  /** Whether the bus has ever published a value for this id. Useful for
   *  UI pickers that want to gray out unavailable signals. */
  has(id: string): boolean {
    return this.values.has(id);
  }

  /** Discard every published signal. Called when patterns are disabled
   *  or the active pattern changes. */
  clear(): void {
    this.values.clear();
  }

  /** Iterator over `[id, value]` entries for debugging / overlay. */
  entries(): IterableIterator<[string, number]> {
    return this.values.entries();
  }
}
