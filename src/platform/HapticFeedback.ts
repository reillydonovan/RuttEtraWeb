/**
 * Tiny wrapper around `navigator.vibrate` for short kinesthetic confirmations.
 *
 * Patterns are kept short (10–35 ms) because Android batches vibrations and
 * iOS Safari ignores the API entirely (it's a no-op there but harmless).
 */

import { SettingsStore } from '../state/Settings';

type Pattern = 'tap' | 'click' | 'success' | 'error';

const PATTERNS: Record<Pattern, number | number[]> = {
  tap:     10,
  click:   18,
  success: [12, 30, 12],
  error:   [40, 40, 40],
};

let _settings: SettingsStore | null = null;

export function attachHaptics(settings: SettingsStore): void {
  _settings = settings;
}

/** Fire a short vibration if enabled in settings. */
export function haptic(p: Pattern): void {
  if (!_settings || !_settings.get('hapticsEnabled')) return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try { nav.vibrate(PATTERNS[p]); } catch { /* ignore */ }
}
