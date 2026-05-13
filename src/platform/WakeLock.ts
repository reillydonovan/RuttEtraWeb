/**
 * Thin wrapper over the Screen Wake Lock API. Acquires a `screen` lock
 * while a "task" is in progress (recording, broadcasting, sequencer
 * playback). If the lock is auto-released by the browser (page hidden),
 * `request()` is retried on visibility change.
 *
 * No-op on browsers without the API.
 */

type WakeLockType = 'screen';
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}
interface WakeLockApi { request(type: WakeLockType): Promise<WakeLockSentinelLike>; }
type WakeLockNavigator = Navigator & { wakeLock?: WakeLockApi };

export class WakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private rebindHandler: (() => void) | null = null;

  async acquire(): Promise<void> {
    this.wanted = true;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await nav.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Permission denied or page hidden — silently fall back.
    }
    if (!this.rebindHandler) {
      this.rebindHandler = () => {
        if (this.wanted && document.visibilityState === 'visible') void this.acquire();
      };
      document.addEventListener('visibilitychange', this.rebindHandler);
    }
  }

  async release(): Promise<void> {
    this.wanted = false;
    if (this.sentinel) {
      try { await this.sentinel.release(); } catch { /* ignore */ }
      this.sentinel = null;
    }
    if (this.rebindHandler) {
      document.removeEventListener('visibilitychange', this.rebindHandler);
      this.rebindHandler = null;
    }
  }

  isHeld(): boolean { return !!this.sentinel && !this.sentinel.released; }
}

let _instance: WakeLock | null = null;
export function wakeLock(): WakeLock {
  if (!_instance) _instance = new WakeLock();
  return _instance;
}
