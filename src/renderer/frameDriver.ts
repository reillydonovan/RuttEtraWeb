/**
 * Backup frame driver for popped-out output windows.
 *
 * The render loop runs on the MAIN window's requestAnimationFrame (via
 * three's `setAnimationLoop`). Browsers stop rAF in a window that's
 * hidden — and on macOS, making a popup fullscreen moves it to its own
 * Space, which hides the main window. The popup shows a captureStream
 * of the main canvas, so with nothing drawing, the fullscreen output
 * froze on its last frame (owner report, 2026-09-30).
 *
 * Fix: any open output popup also ticks on ITS OWN rAF (it's the window
 * the performer is looking at, so it keeps getting frames) and runs the
 * main frame whenever the main loop hasn't produced one recently. While
 * the main window is visible its loop keeps winning and the backup
 * never fires, so there's no double rendering.
 */

let runner: (() => void) | null = null;
let lastFrameAt = 0;

/** A main-loop frame is starting (call from the setAnimationLoop callback). */
export function noteMainFrame(now = performance.now()): void {
  lastFrameAt = now;
}

/** The function that renders one frame (main.ts registers its guarded frame). */
export function setFrameRunner(fn: () => void): void {
  runner = fn;
}

/** How stale the main loop must be before a popup drives a frame (ms). ~2.5 frames at 60 Hz. */
export const STALL_MS = 40;

/** Pure decision, exported for tests. */
export function shouldDriveBackup(now: number, last: number, stallMs = STALL_MS): boolean {
  return now - last > stallMs;
}

/**
 * Tick `win`'s rAF and run a frame whenever the main loop has stalled.
 * `afterTick` (optional) runs every tick after that — the render popout
 * uses it to copy the finished frame into its own canvas.
 * Returns a stop function; also stops on its own once `win` closes.
 */
export function driveFromWindow(win: Window, afterTick?: () => void): () => void {
  let stopped = false;
  const tick = (): void => {
    if (stopped || win.closed) return;
    const now = performance.now();
    if (runner && shouldDriveBackup(now, lastFrameAt)) {
      lastFrameAt = now;
      runner();
    }
    afterTick?.();
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  return () => { stopped = true; };
}
