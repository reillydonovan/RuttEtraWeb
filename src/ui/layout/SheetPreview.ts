/**
 * Phone: a live picture-in-picture of the render while a settings sheet covers
 * it, so a slider change can be seen as it happens (owner: "you have to edit
 * then close the menu"). It is a picture of the one real canvas (#stage,
 * copied with drawImage every frame — the renderer keeps its drawing buffer),
 * never a second renderer. It shows the centre of the screen (where the raster
 * sits) as a square. Drag it anywhere; tap it to tuck it away to a small pill;
 * tap the pill to bring it back (both remembered per device). Hidden while the sheet is
 * pulled down to its lowest snap, where the picture itself is visible.
 */

const KEY = 'rw-sheet-preview';
const POS_KEY = 'rw-sheet-preview-pos';

export class SheetPreview {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private pill: HTMLButtonElement;
  private raf = 0;
  private minimized = false;

  constructor(private stage: HTMLCanvasElement) {
    try { this.minimized = localStorage.getItem(KEY) === 'min'; } catch { /* no storage */ }
    this.el = document.createElement('div');
    this.el.className = 'rw-sheet-preview';
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Live preview — tap to hide');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.bindDrag();
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { x: number; y: number } | null;
      if (pos) this.place(pos.x, pos.y);
    } catch { /* no storage */ }

    this.pill = document.createElement('button');
    this.pill.type = 'button';
    this.pill.className = 'rw-sheet-preview-pill';
    this.pill.textContent = 'Preview';
    this.pill.setAttribute('aria-label', 'Show live preview');
    this.pill.addEventListener('click', () => this.setMinimized(false));
  }

  show(): void {
    if (!this.el.isConnected) document.body.append(this.el, this.pill);
    this.sync();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** Visible or not for the sheet's current height (the lowest snap shows the picture itself). */
  setSuppressed(on: boolean): void {
    this.el.classList.toggle('rw-hidden', on);
    this.pill.classList.toggle('rw-hidden', on);
  }

  hide(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.el.remove();
    this.pill.remove();
    this.setSuppressed(false);
  }

  /** Drag moves it (kept on screen); a press that doesn't move is a tap = tuck away. */
  private bindDrag(): void {
    this.el.addEventListener('pointerdown', (e) => {
      const r = this.el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      this.el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        moved = true;
        this.place(ev.clientX - dx, ev.clientY - dy);
      };
      const up = (): void => {
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
        if (!moved) { this.setMinimized(true); return; }
        const b = this.el.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY, JSON.stringify({ x: b.left, y: b.top })); } catch { /* no storage */ }
      };
      this.el.addEventListener('pointermove', move);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }

  private place(x: number, y: number): void {
    const w = this.el.offsetWidth || 150, h = this.el.offsetHeight || 150;
    const cx = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    const cy = Math.max(4, Math.min(window.innerHeight - h - 4, y));
    Object.assign(this.el.style, { left: `${cx}px`, top: `${cy}px`, right: 'auto' });
  }

  private setMinimized(on: boolean): void {
    this.minimized = on;
    try { localStorage.setItem(KEY, on ? 'min' : 'open'); } catch { /* no storage */ }
    this.sync();
  }

  private sync(): void {
    this.el.classList.toggle('rw-min', this.minimized);
    this.pill.classList.toggle('rw-min', !this.minimized);
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.minimized || this.el.classList.contains('rw-hidden')) return;
    const sw = this.stage.width, sh = this.stage.height;
    if (!sw || !sh) return;
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    // The centre square of the screen — the raster sits in the middle of a portrait phone.
    const side = Math.min(sw, sh);
    ctx.drawImage(this.stage, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, w, h);
  };
}
