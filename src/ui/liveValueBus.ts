/**
 * Lazily-registered handle to the app's LiveValuesStore for UI widgets.
 *
 * `slider()` in widgets.ts runs at panel-build time, but the
 * LiveValuesStore is constructed in main.ts. Same lazy-dependency
 * pattern as `keyframeAffordance.ts`: widgets queue their interest and
 * get called back once main.ts registers the store (or immediately if
 * it already has).
 *
 * This exists so sliders can DISPLAY the live (modulated) value beside
 * the base value they edit. Display only — nothing here may ever write
 * a live value back into Settings (base/live split, principle 2).
 */

import type { LiveValuesStore } from '../modulation/LiveValues';

let store: LiveValuesStore | null = null;
const waiters: Array<(lv: LiveValuesStore) => void> = [];

/** Wire the app's LiveValuesStore. Called once from main.ts. */
export function registerLiveValues(lv: LiveValuesStore): void {
  store = lv;
  for (const fn of waiters.splice(0)) fn(lv);
}

/** Run `fn` with the LiveValuesStore now, or as soon as it registers. */
export function whenLiveValues(fn: (lv: LiveValuesStore) => void): void {
  if (store) fn(store);
  else waiters.push(fn);
}
