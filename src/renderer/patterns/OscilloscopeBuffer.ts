/**
 * Oscilloscope sample buffer — circular `Float32Array` plus a 1D
 * `THREE.DataTexture` ready to feed the oscilloscope fragment shader.
 *
 * Two write modes:
 *   - `pushSample(v)`            — appends one sample (advances head by 1).
 *                                  Used for non-audio sources (mod slot,
 *                                  graph node port, settings param, beat).
 *   - `writeBlock(samples)`      — replaces the whole window in one call.
 *                                  Used for audio (a frame of
 *                                  `analyser.getFloatTimeDomainData()`).
 *
 * Both writers can apply rising-edge trigger alignment when copying to
 * the texture, so the trace stays stable between frames if the source
 * has any periodicity.
 *
 * `pushSample` keeps a circular ring; the visible window is the latest
 * `length` samples. `writeBlock` overwrites the buffer linearly so
 * audio frames render in their natural order.
 *
 * No three.js scenes / WebGL state setters here — we only own the
 * buffer + texture; the renderer binds the texture into materials.
 */

import * as THREE from 'three';

const DEFAULT_LENGTH = 1024;

export class OscilloscopeBuffer {
  /** Width of the visible window, in samples. */
  readonly length: number;
  /** Circular ring of samples (size = length). */
  private buf: Float32Array;
  /** Aligned upload window (size = length). The DataTexture wraps this. */
  private out: Float32Array;
  /** Write head for `pushSample`; index of the NEXT slot to write. */
  private head = 0;
  /** Whether `writeBlock` was the last writer. When true, `out` already
   *  holds an aligned linear window and we skip the ring rotation. */
  private blockMode = false;
  /** Set when a write happened since the last upload — flips
   *  `texture.needsUpdate` on next `uploadIfDirty()`. */
  private dirty = true;

  readonly texture: THREE.DataTexture;

  constructor(length: number = DEFAULT_LENGTH) {
    this.length = Math.max(8, length | 0);
    this.buf = new Float32Array(this.length);
    this.out = new Float32Array(this.length);
    // R32F single-channel float texture; one row, `length` columns.
    this.texture = new THREE.DataTexture(
      this.out as Float32Array<ArrayBuffer>,
      this.length,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** Append one sample to the ring buffer. Advances the head. */
  pushSample(v: number): void {
    this.buf[this.head] = clampSafe(v);
    this.head = (this.head + 1) % this.length;
    this.blockMode = false;
    this.dirty = true;
  }

  /**
   * Replace the visible window with `samples` (one full block).
   * If `samples.length < this.length`, the remainder is zero-filled.
   * If `samples.length > this.length`, only the most recent
   * `this.length` samples are kept (the tail of `samples`).
   */
  writeBlock(samples: Float32Array): void {
    const n = samples.length;
    if (n >= this.length) {
      this.out.set(samples.subarray(n - this.length));
    } else {
      this.out.fill(0);
      this.out.set(samples, 0);
    }
    this.blockMode = true;
    this.dirty = true;
  }

  /**
   * Fill `out` with the visible window. Applies rising-edge trigger
   * alignment if `triggerLevel != 0`. In ring mode we rotate so the
   * latest sample sits at the right edge by default; if a rising edge
   * crossing `triggerLevel` is found inside the window, we shift so
   * that crossing sits at the LEFT edge instead, keeping repetitive
   * waveforms locked in place.
   *
   * Returns `true` if the trace texture was changed this frame.
   */
  uploadIfDirty(triggerLevel: number = 0): boolean {
    if (!this.dirty) return false;

    if (!this.blockMode) {
      // Ring -> linear: latest sample at the right.
      const h = this.head;
      // Copy [head..length) then [0..head) into out
      this.out.set(this.buf.subarray(h));
      this.out.set(this.buf.subarray(0, h), this.length - h);
    }

    if (triggerLevel !== 0) {
      this.alignToTrigger(triggerLevel);
    }

    this.texture.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  /** Reset the buffer to silence. */
  clear(): void {
    this.buf.fill(0);
    this.out.fill(0);
    this.head = 0;
    this.blockMode = false;
    this.dirty = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /**
   * Search for the first rising-edge crossing of `level` in the FIRST
   * HALF of the window and rotate `out` so that crossing is at
   * position 0. Searching only the first half guarantees that even
   * after rotation, at least half a window of subsequent samples is
   * still visible, so the user always sees a useful trace length.
   *
   * If no crossing is found, leaves `out` unchanged.
   */
  private alignToTrigger(level: number): void {
    const half = this.length >> 1;
    let crossing = -1;
    for (let i = 1; i < half; i++) {
      if (this.out[i - 1] < level && this.out[i] >= level) {
        crossing = i;
        break;
      }
    }
    if (crossing <= 0) return;
    // Rotate left by `crossing`. We allocate a small tmp for the
    // prefix; the suffix slides in place.
    const tmp = this.out.slice(0, crossing);
    this.out.copyWithin(0, crossing);
    this.out.set(tmp, this.length - crossing);
  }

  /** Returns a fresh copy of the latest uploaded window. Used by tests
   *  and by the pattern signal pipeline (which doesn't need a copy but
   *  benefits from a stable snapshot if it's iterating the array
   *  multiple times in one frame — cheap at 1024 floats). */
  getOutSnapshot(): Float32Array {
    return this.out.slice();
  }

  /** Non-allocating peek at the upload window. Caller MUST NOT mutate.
   *  Per-frame consumers (PatternRenderer.publishSignals) prefer this
   *  over `getOutSnapshot()` to avoid GC churn at high fps. */
  peekOutWindow(): Float32Array {
    return this.out;
  }

  /**
   * Most-recently written sample, regardless of upload state or
   * trigger alignment. In ring mode this is `buf[head-1]`; in block
   * mode it's the tail of the last block. Used for one-frame trigger
   * detection where the *true* latest matters more than the visible
   * window's last column.
   */
  getLatestSample(): number {
    if (this.blockMode) {
      return this.out[this.length - 1] ?? 0;
    }
    const idx = (this.head - 1 + this.length) % this.length;
    return this.buf[idx] ?? 0;
  }

  /** Test-only accessor for the ring head index. */
  getHead(): number {
    return this.head;
  }
}

function clampSafe(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v > 8) return 8;
  if (v < -8) return -8;
  return v;
}
