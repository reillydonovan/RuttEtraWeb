/**
 * Render-canvas popout: pop the live output into its own draggable
 * browser window, for the classic performance rig — output on a
 * projector/second display, this window fullscreen there, everything
 * else (controls, panel popout) on the operator's screen.
 *
 * Unlike `PanelPopout.ts` (which `adoptNode`s plain DOM into the popup —
 * safe because nothing there holds a WebGL context), the render canvas
 * has a LIVE WebGL context tied to this window's browsing context.
 * Moving the actual `<canvas>` via `adoptNode` is not reliable across
 * browsers — most drop the GL context on transfer. Instead the popup
 * holds a plain 2D canvas that its own rAF loop fills from the main
 * canvas every frame (`drawImage`; same process, no network). This used
 * to be a `canvas.captureStream()` into a `<video>`, but that stream
 * stops producing frames while the main window is hidden — which is
 * what fullscreening this popup does on macOS — so the output froze
 * (v1.31.1). frameDriver.ts keeps the main frame rendering meanwhile.
 *
 * The popup owns a self-contained fullscreen toggle: a corner button
 * that requests/exits the Fullscreen API on the POPUP window (not the
 * main window), relabels itself on state change, and responds to `F`
 * as a keyboard shortcut scoped to the popup (`Esc` already exits
 * fullscreen natively; the button/label stay in sync via
 * `fullscreenchange` regardless of how fullscreen was entered/exited).
 *
 * While fullscreen, the button auto-fades after a few seconds of no
 * mouse movement and fades back in the instant movement is detected —
 * an idle timer driven by `pointermove`, not CSS `:hover` (a motionless
 * cursor sitting inside the window would keep `:hover` true forever,
 * which defeats the point of an idle fade for a performer who parks the
 * mouse and looks away from the controls).
 */

export interface RenderPopoutController {
  /** True while the output lives in the popup window. */
  isOpen(): boolean;
  /** Open the popup and start copying the canvas into it. No-op if already open. */
  popOut(): void;
  /** Close the popup and stop copying. No-op if not open. */
  popIn(): void;
  toggle(): void;
}

import { driveFromWindow } from './frameDriver';


export function createRenderPopout(
  canvas: HTMLCanvasElement,
  onChange?: (open: boolean) => void,
): RenderPopoutController {
  let popup: Window | null = null;
  let stopDrive: (() => void) | null = null;

  function popOut(): void {
    if (popup && !popup.closed) { popup.focus(); return; }
    const aspect = canvas.clientWidth > 0 && canvas.clientHeight > 0
      ? canvas.clientWidth / canvas.clientHeight
      : 16 / 9;
    const w0 = 1280;
    const h0 = Math.round(w0 / aspect);
    const w = window.open('', 'ruttetra-output', `popup=yes,width=${w0},height=${h0}`);
    if (!w) return; // popup blocked — nothing to do, button stays inert
    popup = w;
    const doc = w.document;
    doc.title = 'RUTT/ETRA — Output';

    const style = doc.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      canvas {
        width: 100%; height: 100%; object-fit: contain; background: #000;
        display: block;
      }
      #rw-fs-btn {
        position: fixed; top: 14px; right: 14px; z-index: 10;
        background: rgba(6,10,6,0.85);
        border: 1px solid rgba(95,255,133,0.55);
        color: #7eff9c;
        font: 13px/1 'Share Tech Mono', ui-monospace, Menlo, monospace;
        letter-spacing: 0.06em;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 2px;
        text-transform: uppercase;
        opacity: 1;
        transition: opacity 0.25s ease;
      }
      #rw-fs-btn:hover, #rw-fs-btn:focus-visible {
        border-color: #7eff9c;
        box-shadow: 0 0 8px rgba(95,255,133,0.5);
      }
      /* Idle-fade while fullscreen: hidden by default, revealed by the
         'rw-fs-visible' class that JS toggles on mouse movement (see
         the pointermove listener below) — NOT by :hover, since a
         stationary cursor would keep :hover true indefinitely. */
      body.rw-fs-active #rw-fs-btn { opacity: 0; pointer-events: none; }
      body.rw-fs-active.rw-fs-visible #rw-fs-btn { opacity: 1; pointer-events: auto; }
    `;
    doc.head.appendChild(style);

    // The output is COPIED into a canvas here every popup frame, not
    // streamed (v1.31.1, owner report): a captureStream() of the main
    // canvas stops producing frames while the main window is hidden —
    // which is exactly what fullscreening this popup does on macOS (own
    // Space). The copy runs on THIS window's rAF (it's the visible one),
    // right after frameDriver has rendered a frame if the main loop
    // stalled; the renderer keeps its drawing buffer
    // (preserveDrawingBuffer: true), so the copy is valid at any time.
    const out = doc.createElement('canvas');
    doc.body.appendChild(out);
    const outCtx = out.getContext('2d', { alpha: false });
    const copyFrame = (): void => {
      if (!outCtx || canvas.width === 0 || canvas.height === 0) return;
      if (out.width !== canvas.width || out.height !== canvas.height) {
        out.width = canvas.width;
        out.height = canvas.height;
      }
      outCtx.drawImage(canvas, 0, 0);
    };
    stopDrive = driveFromWindow(w, copyFrame);

    const fsBtn = doc.createElement('button');
    fsBtn.id = 'rw-fs-btn';
    fsBtn.type = 'button';

    // Idle-fade: visible on movement, hidden again after IDLE_MS of no
    // movement — only while fullscreen (outside fullscreen the button
    // just stays at its default full opacity).
    const IDLE_MS = 2500;
    let idleTimer: number | null = null;
    const clearIdleTimer = (): void => {
      if (idleTimer !== null) { w.clearTimeout(idleTimer); idleTimer = null; }
    };
    const showBtn = (): void => {
      doc.body.classList.add('rw-fs-visible');
      clearIdleTimer();
      if (doc.fullscreenElement) {
        idleTimer = w.setTimeout(() => doc.body.classList.remove('rw-fs-visible'), IDLE_MS);
      }
    };

    const syncFsLabel = (): void => {
      const isFs = !!doc.fullscreenElement;
      fsBtn.textContent = isFs ? '⤢ Exit Fullscreen' : '⛶ Fullscreen';
      doc.body.classList.toggle('rw-fs-active', isFs);
      if (isFs) showBtn();
      else { clearIdleTimer(); doc.body.classList.remove('rw-fs-visible'); }
    };
    const toggleFs = (): void => {
      if (doc.fullscreenElement) void doc.exitFullscreen();
      else void doc.documentElement.requestFullscreen().catch(() => { /* denied — button just stays put */ });
    };
    fsBtn.addEventListener('click', toggleFs);
    doc.addEventListener('fullscreenchange', syncFsLabel);
    doc.addEventListener('pointermove', showBtn);
    syncFsLabel();
    doc.body.appendChild(fsBtn);

    // `F` toggles fullscreen, scoped to this popup only.
    doc.addEventListener('keydown', (ev) => {
      if (ev.key === 'f' || ev.key === 'F') {
        ev.preventDefault();
        toggleFs();
      }
    });

    // Either side closing tears the popup down.
    w.addEventListener('pagehide', popIn);
    window.addEventListener('pagehide', closePopup);
    onChange?.(true);
  }

  function closePopup(): void {
    stopDrive?.();
    stopDrive = null;
    if (popup && !popup.closed) popup.close();
    popup = null;
  }

  function popIn(): void {
    closePopup();
    window.removeEventListener('pagehide', closePopup);
    onChange?.(false);
  }

  return {
    isOpen: () => popup != null && !popup.closed,
    popOut,
    popIn,
    toggle(): void {
      if (popup && !popup.closed) popIn(); else popOut();
    },
  };
}
