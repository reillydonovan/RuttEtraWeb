/**
 * Compact-mode capture dock — the phone's "camera app" strip, floating over
 * the full-bleed render just above the tab bar:
 *
 *   looks carousel   swipe sideways, tap a look to apply it (built-in presets)
 *   [flip]  (shutter)  [PHOTO | VIDEO]
 *
 * PHOTO: the shutter saves a PNG of the output (native share sheet when the
 * browser can share files, a download otherwise). VIDEO: the shutter starts /
 * stops the recorder, with a running timer; when the file is saved a toast
 * offers the share sheet (sharing needs a fresh tap, so it can't be automatic).
 *
 * Pure UI — every capability comes in through `CaptureDockDeps`, so main.ts
 * stays the one place that owns the recorder, the video source and Settings
 * (principle 1). Desktop never mounts it.
 */

import { PRESETS } from '../presets';

export interface CaptureDockDeps {
  /** Apply a built-in look (main.ts routes through presetPatch). */
  applyLook: (id: string) => void;
  /** PNG of the output right now (drawn inside a rAF so the frame is fresh). */
  takePhoto: () => Promise<Blob>;
  /** Start/stop the recorder. */
  toggleRecord: () => Promise<void> | void;
  isRecording: () => boolean;
  /** Subscribe to recorder state; returns an unsubscribe. */
  onRecordState: (fn: (s: 'idle' | 'recording' | 'finalizing') => void) => () => void;
  elapsedMs: () => number;
  /** Swap front/back camera; resolves to the facing now in use, or null when
   *  the active source isn't a webcam (button is then a no-op with a hint). */
  flipCamera: () => Promise<'user' | 'environment' | null>;
  /** The phone's Source sheet leads with these four big choices. */
  quickSource?: {
    webcam: (facing: 'user' | 'environment') => Promise<void>;
    pattern: () => void;
    library: () => void;
    activeKind: () => string;
    facing: () => 'user' | 'environment';
  };
  toast: (msg: string, action?: { label: string; onClick: () => void }) => void;
  haptic: (kind: 'tap' | 'click' | 'success' | 'error') => void;
}

type Mode = 'photo' | 'video';

const MODE_KEY = 'rw-capture-mode';

export class CaptureDock {
  readonly el: HTMLElement;
  private deps: CaptureDockDeps;
  private mode: Mode = 'photo';
  private shutter: HTMLButtonElement;
  private timer: HTMLElement;
  private modeBtns = new Map<Mode, HTMLButtonElement>();
  private looks = new Map<string, HTMLButtonElement>();
  private tick: number | null = null;
  private lastPhoto: File | null = null;

  constructor(deps: CaptureDockDeps) {
    this.deps = deps;
    try { if (localStorage.getItem(MODE_KEY) === 'video') this.mode = 'video'; } catch { /* private mode */ }

    this.el = document.createElement('section');
    this.el.id = 'capture-dock';
    this.el.setAttribute('aria-label', 'Capture');

    // ---- looks carousel
    const strip = document.createElement('div');
    strip.className = 'rw-looks';
    strip.setAttribute('role', 'listbox');
    strip.setAttribute('aria-label', 'Looks');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-look';
      b.textContent = p.name;
      b.dataset.look = p.id;
      b.setAttribute('role', 'option');
      b.addEventListener('click', () => this.pickLook(p.id));
      this.looks.set(p.id, b);
      strip.appendChild(b);
    }

    // ---- control row
    const row = document.createElement('div');
    row.className = 'rw-capture-row';

    const flip = document.createElement('button');
    flip.type = 'button';
    flip.className = 'rw-cap-btn rw-cap-flip';
    flip.setAttribute('aria-label', 'Flip camera');
    flip.innerHTML = ICON_FLIP;
    flip.addEventListener('click', () => void this.flip());

    this.shutter = document.createElement('button');
    this.shutter.type = 'button';
    this.shutter.className = 'rw-shutter';
    this.shutter.innerHTML = '<span class="rw-shutter-core"></span>';
    this.shutter.addEventListener('click', () => void this.press());

    this.timer = document.createElement('div');
    this.timer.className = 'rw-cap-timer';
    this.timer.hidden = true;

    const seg = document.createElement('div');
    seg.className = 'rw-cap-mode';
    seg.setAttribute('role', 'tablist');
    for (const m of ['photo', 'video'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = m === 'photo' ? 'Photo' : 'Video';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setMode(m));
      this.modeBtns.set(m, b);
      seg.appendChild(b);
    }

    const shutterWrap = document.createElement('div');
    shutterWrap.className = 'rw-shutter-wrap';
    shutterWrap.append(this.timer, this.shutter);

    row.append(flip, shutterWrap, seg);
    this.el.append(strip, row);

    this.setMode(this.mode);
    deps.onRecordState((s) => this.onRecordState(s));
  }

  /** Mark the look in use (also called by the top strip's name label). */
  setActiveLook(id: string | null): void {
    for (const [lid, b] of this.looks) {
      const on = lid === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }

  private pickLook(id: string): void {
    this.deps.haptic('click');
    this.deps.applyLook(id);
    this.setActiveLook(id);
  }

  private setMode(m: Mode): void {
    if (this.deps.isRecording()) return;   // never swap modes mid-take
    this.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    for (const [id, b] of this.modeBtns) {
      b.classList.toggle('active', id === m);
      b.setAttribute('aria-selected', String(id === m));
    }
    this.el.dataset.mode = m;
    this.shutter.setAttribute('aria-label', m === 'photo' ? 'Take photo' : 'Start recording');
  }

  private async press(): Promise<void> {
    if (this.mode === 'video') {
      this.deps.haptic('click');
      try { await this.deps.toggleRecord(); }
      catch (e) { this.deps.haptic('error'); this.deps.toast(`Recording failed: ${(e as Error).message}`); }
      return;
    }
    // PHOTO
    this.el.classList.add('flash');
    window.setTimeout(() => this.el.classList.remove('flash'), 160);
    this.deps.haptic('tap');
    try {
      const blob = await this.deps.takePhoto();
      const file = new File([blob], `ruttetra-${stamp()}.png`, { type: 'image/png' });
      this.lastPhoto = file;
      await this.deliver(file);
    } catch (e) {
      this.deps.haptic('error');
      this.deps.toast(`Photo failed: ${(e as Error).message}`);
    }
  }

  /** Share sheet where the browser supports sharing files; download otherwise. */
  private async deliver(file: File): Promise<void> {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'Rutt/Etra Web' });
        this.deps.haptic('success');
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;   // user closed the sheet — not an error
        // Any other failure (e.g. share needs a fresh gesture): fall through to a download.
      }
    }
    downloadFile(file);
    this.deps.haptic('success');
    this.deps.toast('Photo saved.');
  }

  private async flip(): Promise<void> {
    this.deps.haptic('click');
    try {
      const facing = await this.deps.flipCamera();
      if (facing == null) this.deps.toast('Flip works with a camera source — pick Webcam in Source first.');
      else this.el.dataset.facing = facing;
    } catch (e) {
      this.deps.haptic('error');
      this.deps.toast(`Camera: ${(e as Error).message}`);
    }
  }

  private onRecordState(s: 'idle' | 'recording' | 'finalizing'): void {
    const rec = s === 'recording';
    this.el.classList.toggle('recording', rec);
    this.shutter.classList.toggle('recording', rec);
    this.shutter.disabled = s === 'finalizing';
    this.shutter.setAttribute('aria-label', rec ? 'Stop recording' : this.mode === 'photo' ? 'Take photo' : 'Start recording');
    this.timer.hidden = !rec;
    if (this.tick != null) { clearInterval(this.tick); this.tick = null; }
    if (rec) {
      const draw = () => { this.timer.textContent = fmt(this.deps.elapsedMs()); };
      draw();
      this.tick = window.setInterval(draw, 250);
    }
  }

  /** Offer the native share sheet for a just-saved recording. */
  offerShare(file: File): void {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!(typeof nav.share === 'function' && nav.canShare?.({ files: [file] }))) {
      this.deps.toast('Video saved.');
      return;
    }
    this.deps.toast('Video saved.', {
      label: 'Share',
      onClick: () => { void nav.share!({ files: [file], title: 'Rutt/Etra Web' }).catch(() => { /* cancelled */ }); },
    });
  }

  /** The last photo taken this session, if any (for a future gallery chip). */
  get lastCapture(): File | null { return this.lastPhoto; }

  dispose(): void {
    if (this.tick != null) clearInterval(this.tick);
    this.el.remove();
  }
}

function stamp(): string { return new Date().toISOString().replace(/[:.]/g, '-'); }

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ICON_FLIP =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/>' +
  '<path d="M9.2 13.2a3 3 0 0 1 5.2-1.3M14.8 14.8a3 3 0 0 1-5.2 1.3"/><path d="M14.6 10.4v1.6h-1.6M9.4 17.6V16h1.6"/></svg>';
