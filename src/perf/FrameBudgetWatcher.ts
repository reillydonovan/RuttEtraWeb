/**
 * Sliding-window frame-time monitor. If the average frame time over a
 * 3-second window exceeds 32 ms (≈30 fps), it suggests the user switch to
 * the `battery` performance profile via a toast.
 *
 * The watcher only suggests once per session unless dismissed-and-recover.
 */

import { LayoutManager } from '../ui/layout/LayoutManager';

export interface FrameBudgetCallbacks {
  /** Show a "performance is choppy — switch to battery?" toast. */
  suggestBatteryProfile: () => void;
  /** Optional: called every 500ms with the rolling avg ms (for debug overlay). */
  onUpdate?: (avgMs: number, fps: number) => void;
}

export class FrameBudgetWatcher {
  private samples: { t: number; dt: number }[] = [];
  private suggested = false;
  private lastReport = 0;
  private layout: LayoutManager;

  constructor(layout: LayoutManager, private cb: FrameBudgetCallbacks) {
    this.layout = layout;
  }

  /** Call once per RAF with the just-elapsed frame's delta in seconds. */
  onFrame(dtSec: number): void {
    const now = performance.now();
    const dtMs = dtSec * 1000;
    this.samples.push({ t: now, dt: dtMs });
    while (this.samples.length > 0 && now - this.samples[0].t > 3000) this.samples.shift();

    if (now - this.lastReport > 500 && this.samples.length > 5) {
      this.lastReport = now;
      const avg = this.average();
      this.cb.onUpdate?.(avg, 1000 / Math.max(avg, 0.0001));
      // Trigger suggestion once if we're consistently above 32 ms.
      // Compact-only: on desktop (standard / expansive) the user's machine
      // is already as fast as it's going to get, and forcing the Battery
      // profile just degrades render quality. On phones the trade is real:
      // dropping to Battery saves frames and battery life.
      if (
        !this.suggested &&
        this.layout.current() === 'compact' &&
        avg > 32 &&
        this.samples.length > 30
      ) {
        this.suggested = true;
        this.cb.suggestBatteryProfile();
      }
    }
  }

  private average(): number {
    if (this.samples.length === 0) return 0;
    let s = 0;
    for (const x of this.samples) s += x.dt;
    return s / this.samples.length;
  }

  resetSuggestion(): void { this.suggested = false; }
}
