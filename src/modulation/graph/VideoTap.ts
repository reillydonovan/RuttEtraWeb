/**
 * VideoTap — turns the input video into cheap CPU-side readbacks shared
 * by every `video-*` graph node.
 *
 * Why two resolutions?
 *   - 64×64 is plenty for region averages (luma, motion, color hue/sat).
 *   - 256×256 backs row / column / edge sources where finer detail
 *     matters (a 64-px-wide column is too narrow for a useful 1px
 *     scanline read).
 *
 * The implementation uses two offscreen 2D canvases — `drawImage` +
 * `getImageData` is the simplest cross-browser readback path and is
 * fast enough for our budget. The spec calls out a future WebGL2 PBO
 * upgrade if profiling reveals the readback hurting frame time.
 *
 * Coordinate convention: rect/x/y/w/h are normalized 0..1; (0,0) is the
 * top-left of the video as humans see it (matches `getImageData`'s
 * top-left origin and the inspector's region picker overlay).
 */

import { Rect, VideoTapLike } from './types';

const LO_SIZE = 64;
const HI_SIZE = 256;

export class VideoTap implements VideoTapLike {
  private video: HTMLVideoElement;
  private loCanvas: HTMLCanvasElement;
  private loCtx: CanvasRenderingContext2D;
  private hiCanvas: HTMLCanvasElement;
  private hiCtx: CanvasRenderingContext2D;

  private loData: Uint8ClampedArray | null = null;
  private hiData: Uint8ClampedArray | null = null;
  private prevLoData: Uint8ClampedArray | null = null;
  private lastTime = -1;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.loCanvas = makeCanvas(LO_SIZE);
    this.hiCanvas = makeCanvas(HI_SIZE);
    this.loCtx = ctxFor(this.loCanvas);
    this.hiCtx = ctxFor(this.hiCanvas);
  }

  /**
   * Pull a fresh frame into both readbacks. Call once per frame from the
   * main loop *before* `graph.tick()`. Returns false if the video isn't
   * playing yet (no readback performed).
   */
  tick(): boolean {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight) return false;
    if (v.readyState < 2) return false;
    const t = v.currentTime;
    if (t === this.lastTime && v.videoWidth === this.lastWidth && v.videoHeight === this.lastHeight) {
      // Frame hasn't advanced — skip the readback to save the stall.
      return true;
    }
    this.lastTime = t;
    this.lastWidth = v.videoWidth;
    this.lastHeight = v.videoHeight;

    // Lo readback
    this.loCtx.drawImage(v, 0, 0, LO_SIZE, LO_SIZE);
    const lo = this.loCtx.getImageData(0, 0, LO_SIZE, LO_SIZE);
    if (this.loData) this.prevLoData = new Uint8ClampedArray(this.loData);
    this.loData = lo.data;

    // Hi readback (lazy — only when something has actually requested hi-res)
    if (this.hiNeeded) {
      this.hiCtx.drawImage(v, 0, 0, HI_SIZE, HI_SIZE);
      const hi = this.hiCtx.getImageData(0, 0, HI_SIZE, HI_SIZE);
      this.hiData = hi.data;
    }
    return true;
  }

  // The `video-luma-row` / `video-luma-col` / `video-edge` nodes call
  // these to register their need for the high-res readback. The engine
  // pre-walks the patch on `setPatch` and flips this flag, but as a
  // belt-and-braces fallback the methods themselves trip it on first use.
  hiNeeded = false;
  ensureHi(): void { this.hiNeeded = true; }

  // ---------- Public API ----------

  getLumaRegion(rect: Rect, hi = false): number {
    const data = (hi && this.hiData) ? this.hiData : this.loData;
    const size = (hi && this.hiData) ? HI_SIZE : LO_SIZE;
    if (!data) return 0;
    return averageLuma(data, size, rect);
  }

  getColorRegion(rect: Rect): { h: number; s: number; v: number } {
    if (!this.loData) return { h: 0, s: 0, v: 0 };
    return averageHsv(this.loData, LO_SIZE, rect);
  }

  getMotionRegion(rect: Rect): number {
    if (!this.loData || !this.prevLoData) return 0;
    return frameDelta(this.loData, this.prevLoData, LO_SIZE, rect);
  }

  getEdgeDensity(rect: Rect): number {
    this.ensureHi();
    const data = this.hiData ?? this.loData;
    const size = this.hiData ? HI_SIZE : LO_SIZE;
    if (!data) return 0;
    return sobelDensity(data, size, rect);
  }

  getRow(y: number): number {
    this.ensureHi();
    const data = this.hiData ?? this.loData;
    const size = this.hiData ? HI_SIZE : LO_SIZE;
    if (!data) return 0;
    const row = Math.max(0, Math.min(size - 1, Math.floor(y * size)));
    return averageLuma(data, size, { x: 0, y: row / size, w: 1, h: 1 / size });
  }

  getCol(x: number): number {
    this.ensureHi();
    const data = this.hiData ?? this.loData;
    const size = this.hiData ? HI_SIZE : LO_SIZE;
    if (!data) return 0;
    const col = Math.max(0, Math.min(size - 1, Math.floor(x * size)));
    return averageLuma(data, size, { x: col / size, y: 0, w: 1 / size, h: 1 });
  }

  /** Returns the lo-res buffer for the inspector's region-picker thumbnail. */
  getThumbnail(): { data: Uint8ClampedArray; size: number } | null {
    if (!this.loData) return null;
    return { data: this.loData, size: LO_SIZE };
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function ctxFor(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('VideoTap: 2d context unavailable');
  return ctx;
}

function regionPx(size: number, rect: Rect): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.max(0, Math.floor(rect.x * size));
  const y0 = Math.max(0, Math.floor(rect.y * size));
  const x1 = Math.min(size, Math.ceil((rect.x + rect.w) * size));
  const y1 = Math.min(size, Math.ceil((rect.y + rect.h) * size));
  return {
    x0, y0,
    x1: Math.max(x0 + 1, x1),
    y1: Math.max(y0 + 1, y1),
  };
}

function averageLuma(data: Uint8ClampedArray, size: number, rect: Rect): number {
  const { x0, y0, x1, y1 } = regionPx(size, rect);
  let sum = 0; let n = 0;
  for (let y = y0; y < y1; y++) {
    let off = (y * size + x0) * 4;
    for (let x = x0; x < x1; x++) {
      // Rec.601 luma weights.
      sum += 0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2];
      off += 4;
      n++;
    }
  }
  return n > 0 ? (sum / n) / 255 : 0;
}

function frameDelta(cur: Uint8ClampedArray, prev: Uint8ClampedArray, size: number, rect: Rect): number {
  const { x0, y0, x1, y1 } = regionPx(size, rect);
  let sum = 0; let n = 0;
  for (let y = y0; y < y1; y++) {
    let off = (y * size + x0) * 4;
    for (let x = x0; x < x1; x++) {
      const dr = cur[off]   - prev[off];
      const dg = cur[off+1] - prev[off+1];
      const db = cur[off+2] - prev[off+2];
      sum += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      off += 4;
      n++;
    }
  }
  return n > 0 ? (sum / n) / (3 * 255) : 0;
}

function averageHsv(data: Uint8ClampedArray, size: number, rect: Rect): { h: number; s: number; v: number } {
  const { x0, y0, x1, y1 } = regionPx(size, rect);
  let sumH = 0, sumS = 0, sumV = 0; let n = 0;
  for (let y = y0; y < y1; y++) {
    let off = (y * size + x0) * 4;
    for (let x = x0; x < x1; x++) {
      const r = data[off] / 255, g = data[off+1] / 255, b = data[off+2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const v = max;
      const d = max - min;
      const s = max === 0 ? 0 : d / max;
      let h = 0;
      if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = h / 6;
        if (h < 0) h += 1;
      }
      sumH += h; sumS += s; sumV += v;
      off += 4;
      n++;
    }
  }
  return n > 0 ? { h: sumH / n, s: sumS / n, v: sumV / n } : { h: 0, s: 0, v: 0 };
}

function sobelDensity(data: Uint8ClampedArray, size: number, rect: Rect): number {
  const { x0, y0, x1, y1 } = regionPx(size, rect);
  let sum = 0; let n = 0;
  for (let y = Math.max(1, y0); y < Math.min(size - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(size - 1, x1); x++) {
      const off = (y * size + x) * 4;
      const c = lumaAt(data, off);
      const ox1 = ((y) * size + (x - 1)) * 4;
      const ox2 = ((y) * size + (x + 1)) * 4;
      const oy1 = ((y - 1) * size + x) * 4;
      const oy2 = ((y + 1) * size + x) * 4;
      const gx = lumaAt(data, ox2) - lumaAt(data, ox1);
      const gy = lumaAt(data, oy2) - lumaAt(data, oy1);
      sum += Math.min(1, Math.hypot(gx, gy));
      n++;
      void c;
    }
  }
  return n > 0 ? sum / n : 0;
}

function lumaAt(data: Uint8ClampedArray, off: number): number {
  return (0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2]) / 255;
}
