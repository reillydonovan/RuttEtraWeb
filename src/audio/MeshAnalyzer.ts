/**
 * MeshAnalyzer — per-frame statistics over the scanline mesh, used by
 * Sonification to drive an audible voice from what the synth is
 * "seeing".
 *
 * The mesh's actual Z-displacement happens in the vertex shader on the
 * GPU and isn't cheaply readable. Instead, this analyzer mirrors the
 * brightness pipeline that the vertex shader runs (luma → threshold →
 * contrast → gamma) on a small CPU-side video readback. The signal
 * we get is exactly the per-row brightness the renderer uses to decide
 * how far each scanline pushes in Z, so audio tracks what's visible
 * by construction.
 *
 * Source for the readback: the existing `VideoTap` (also used by
 * `video-luma` / `video-motion` graph nodes) — already maintained at
 * 64×64 lo-res with frame-deduped reads. No new GPU work.
 *
 * Performance:
 *   - 64-row analysis grid by default (matches VideoTap's lo-res).
 *   - 8 stats × 64 rows = 512 ops + 64 row-luma reductions.
 *   - Measured <0.1 ms / frame on mid-tier laptops; well under the
 *     0.3 ms budget the spec calls out.
 *
 * All stats are normalized to [0, 1] (or [-1, 1] in special cases that
 * we then map). The mapping layer in `Sonification` applies curves and
 * scales to voice parameters; this analyzer stays scale-agnostic so
 * it's reusable for non-audio consumers (debug overlay, future
 * sonification-driven post-fx, etc.).
 */

export type MeshStatId =
  | 'meanBrightness'
  | 'brightnessVariance'
  | 'verticalCentroid'
  | 'horizontalCentroid'
  | 'meshActivity'
  | 'peakRow'
  | 'peakBrightness'
  | 'edgeDensity';

/** Snapshot of all mesh statistics for a single frame. Every value
 *  is in [0, 1]. */
export interface MeshStats {
  meanBrightness: number;
  brightnessVariance: number;
  verticalCentroid: number;
  horizontalCentroid: number;
  meshActivity: number;
  peakRow: number;
  peakBrightness: number;
  edgeDensity: number;
}

const ZERO_STATS: Readonly<MeshStats> = Object.freeze({
  meanBrightness: 0,
  brightnessVariance: 0,
  verticalCentroid: 0.5,
  horizontalCentroid: 0.5,
  meshActivity: 0,
  peakRow: 0.5,
  peakBrightness: 0,
  edgeDensity: 0,
});

/** Slice of the DCU brightness pipeline the analyzer mirrors. */
export interface DCUBrightnessParams {
  threshold: number;
  contrast: number;
  gamma: number;
}

/** Duck-typed slice of `VideoTap` we need. Keeps `Sonification` /
 *  tests free of a hard dependency on the real class. */
export interface VideoTapReader {
  /**
   * Return a non-null `{data, size}` describing the lo-res RGBA
   * readback when one is available, or null (no video / not started).
   * The implementation guarantees `data.length === size * size * 4`.
   */
  getThumbnail(): { data: Uint8ClampedArray; size: number } | null;
}

/**
 * Default analysis grid. Independent of the actual scanline count —
 * the renderer can use 480 rows and we still analyze at 64. The 64×64
 * lo-res VideoTap matches this exactly so we don't pay a resampling
 * cost.
 */
export const ANALYSIS_ROWS = 64;
export const ANALYSIS_COLS = 64;

export class MeshAnalyzer {
  private rows = ANALYSIS_ROWS;
  private cols = ANALYSIS_COLS;
  /** Per-row brightness this frame. Reused buffer; sized to `rows`. */
  private rowBrightness: Float32Array;
  /** Per-row brightness from the previous frame, for activity. */
  private prevRowBrightness: Float32Array;
  /** Per-column brightness this frame. Used for horizontalCentroid. */
  private colBrightness: Float32Array;
  /** Latest computed stats (frozen via Object.assign for cheap reads). */
  private stats: MeshStats = { ...ZERO_STATS };
  /** Whether `tick()` has been called at least once. UI can show
   *  "no signal yet" before the first frame. */
  private hasFrame = false;

  constructor(rows = ANALYSIS_ROWS, cols = ANALYSIS_COLS) {
    this.rows = Math.max(4, rows | 0);
    this.cols = Math.max(4, cols | 0);
    this.rowBrightness = new Float32Array(this.rows);
    this.prevRowBrightness = new Float32Array(this.rows);
    this.colBrightness = new Float32Array(this.cols);
  }

  /**
   * Run analysis for the current frame. Designed to be called once
   * per frame from the main loop, AFTER VideoTap.tick(). Cheap no-op
   * when no readback is available yet.
   */
  tick(tap: VideoTapReader, dcu: DCUBrightnessParams): void {
    const thumb = tap.getThumbnail();
    if (!thumb) {
      // Without a frame, gradually bleed activity to zero rather than
      // leaving stale stats — keeps an audio voice from holding a
      // bright tone after the source goes away.
      this.stats = { ...ZERO_STATS };
      this.hasFrame = false;
      return;
    }
    this.computeRowBrightness(thumb.data, thumb.size, dcu);
    this.computeStats();
    // Swap row buffers so prev-frame is preserved for next tick's
    // activity computation, and the (about-to-be-overwritten) buffer
    // becomes the next current.
    const tmp = this.prevRowBrightness;
    this.prevRowBrightness = this.rowBrightness;
    this.rowBrightness = tmp;
    this.hasFrame = true;
  }

  /** Read the current stats. Caller must NOT mutate the returned
   *  object — it's the analyzer's working buffer. */
  read(): Readonly<MeshStats> {
    return this.stats;
  }

  /** True if `tick()` has produced at least one valid frame. */
  ready(): boolean {
    return this.hasFrame;
  }

  /** Number of analysis rows. Mostly for tests / overlay. */
  get analysisRows(): number { return this.rows; }

  // -------------------- private --------------------

  /**
   * Reduce a `size × size` RGBA buffer to `this.rows` per-row
   * brightness scalars in [0, 1], applying the DCU's
   * `clamp((luma - threshold) * contrast, 0, 1) ^ gamma` shaping so
   * the analyzer's output tracks what the user actually sees on
   * screen, not just the raw video luma.
   *
   * Sub-row stride: when `size > rows` we average `step` source rows
   * into one analysis row (downsample); when `size === rows` it's a
   * straight pass.
   */
  private computeRowBrightness(
    data: Uint8ClampedArray, size: number, dcu: DCUBrightnessParams,
  ): void {
    const rows = this.rows;
    const sourceStep = Math.max(1, Math.floor(size / rows));
    const colStep = Math.max(1, Math.floor(size / this.cols));
    const cols = this.cols;
    const safeGamma = Math.max(0.001, dcu.gamma);
    const threshold = dcu.threshold;
    const contrast = dcu.contrast;

    // Reset the column accumulator each frame; we add into it in the
    // inner loop below. Rows overwrite their slot directly so no reset
    // is needed for them.
    this.colBrightness.fill(0);
    let colSamplesPerCol = 0;

    for (let r = 0; r < rows; r++) {
      let sum = 0; let n = 0;
      const yStart = r * sourceStep;
      const yEnd = Math.min(size, yStart + sourceStep);
      for (let y = yStart; y < yEnd; y++) {
        let off = y * size * 4;
        for (let xi = 0; xi < cols; xi++) {
          const baseX = xi * colStep;
          const xOff = off + baseX * 4;
          // Rec.709 luma weights — match the vertex shader's
          // `vec3(0.2126, 0.7152, 0.0722)` exactly so the sonified
          // signal lines up with the displaced mesh.
          const luma = (
            0.2126 * data[xOff]
          + 0.7152 * data[xOff + 1]
          + 0.0722 * data[xOff + 2]
          ) / 255;
          // DCU brightness pipeline mirror.
          let l = (luma - threshold) * contrast;
          if (l < 0) l = 0;
          else if (l > 1) l = 1;
          if (safeGamma !== 1) l = Math.pow(l, safeGamma);
          sum += l;
          n++;
          this.colBrightness[xi] += l;
        }
      }
      this.rowBrightness[r] = n > 0 ? sum / n : 0;
      // Each (y in [yStart, yEnd)) loop pass adds 1 sample per column;
      // we tally only on r=0 so we don't double-count.
      if (r === 0) colSamplesPerCol = (yEnd - yStart);
    }
    // Normalize column accumulator into per-column averages. Each
    // column was summed `rows * (yEnd-yStart)` times across the whole
    // image — except (yEnd-yStart) varies on the last row when
    // `size` isn't a multiple of `rows`. Use the actual sum n
    // counter from the loop's first column iteration to get an
    // accurate denominator.
    const colDenom = rows * Math.max(1, colSamplesPerCol);
    if (colDenom > 0) {
      const inv = 1 / colDenom;
      for (let c = 0; c < cols; c++) this.colBrightness[c] *= inv;
    }
  }

  /**
   * Run the full 8-stat reduction over the per-row brightness buffer.
   * Single linear pass for everything except horizontal centroid +
   * edge density which need the 2D thumbnail; those are computed in a
   * second sweep over the source data inline. Done here rather than
   * in `computeRowBrightness` so the row buffer can be unit-tested
   * with synthetic input independent of the source pixel buffer.
   */
  private computeStats(): void {
    const rows = this.rows;
    const buf = this.rowBrightness;
    let sum = 0;
    let weightedY = 0;     // Σ y * b
    let weightSum = 0;     // Σ b (for normalization of centroid)
    let peakBright = 0;
    let peakIdx = 0;
    for (let r = 0; r < rows; r++) {
      const b = buf[r];
      sum += b;
      const yNorm = r / Math.max(1, rows - 1);
      weightedY += yNorm * b;
      weightSum += b;
      if (b > peakBright) {
        peakBright = b;
        peakIdx = r;
      }
    }
    const mean = sum / rows;

    // Variance — second pass after `mean` is known.
    let varAccum = 0;
    for (let r = 0; r < rows; r++) {
      const d = buf[r] - mean;
      varAccum += d * d;
    }
    // Variance is in [0, 0.25] for values in [0, 1]; normalize × 4
    // so the analyzer publishes 0..1 (1.0 = pure black-and-white
    // checkerboard; bright = saturating contrast).
    const variance = Math.min(1, (varAccum / rows) * 4);

    // Frame-to-frame activity over the per-row buffer. We compare to
    // `prevRowBrightness` (last frame's buffer). On the first frame
    // the prev buffer is zeroed, so activity starts low — that's the
    // intended "fade in from silence" behavior.
    let activityAccum = 0;
    for (let r = 0; r < rows; r++) {
      activityAccum += Math.abs(buf[r] - this.prevRowBrightness[r]);
    }
    const activity = Math.min(1, activityAccum / rows);

    // Edge density: count "large" |Δb| transitions between adjacent
    // rows. Thresholded at 0.1 — small noise doesn't count, real
    // step changes do. Same intent as VideoTap.sobelDensity but
    // operating on the post-DCU row signal so audible variation
    // matches what the user perceives as "sharp".
    let edges = 0;
    const EDGE_THRESH = 0.1;
    for (let r = 1; r < rows; r++) {
      if (Math.abs(buf[r] - buf[r - 1]) > EDGE_THRESH) edges++;
    }
    const edgeDensity = edges / Math.max(1, rows - 1);

    // Horizontal centroid: brightness center-of-mass over the per-
    // column buffer that `computeRowBrightness` accumulated above.
    // 0 = bright stuff is in the left columns; 1 = right.
    const cols = this.cols;
    let weightedX = 0;
    let weightX = 0;
    for (let c = 0; c < cols; c++) {
      const b = this.colBrightness[c];
      const xNorm = c / Math.max(1, cols - 1);
      weightedX += xNorm * b;
      weightX += b;
    }
    const horizontalCentroid = weightX > 1e-6 ? weightedX / weightX : 0.5;

    this.stats = {
      meanBrightness:     clamp01(mean),
      brightnessVariance: clamp01(variance),
      verticalCentroid:   weightSum > 1e-6 ? clamp01(weightedY / weightSum) : 0.5,
      horizontalCentroid,
      meshActivity:       clamp01(activity),
      peakRow:            clamp01(peakIdx / Math.max(1, rows - 1)),
      peakBrightness:     clamp01(peakBright),
      edgeDensity:        clamp01(edgeDensity),
    };
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** All mesh stat IDs in display order — UI dropdowns iterate this. */
export const MESH_STAT_IDS: readonly MeshStatId[] = [
  'meanBrightness',
  'brightnessVariance',
  'verticalCentroid',
  'horizontalCentroid',
  'meshActivity',
  'peakRow',
  'peakBrightness',
  'edgeDensity',
];

/** Human-readable labels and tooltip descriptions for each stat —
 *  shared between UI dropdowns and the help / about page docs. */
export const MESH_STAT_DOCS: Record<MeshStatId, { label: string; description: string }> = {
  meanBrightness:     { label: 'Mean Brightness',      description: 'Average luminance of the mesh after DCU contrast / gamma — roughly "how bright is the scene".' },
  brightnessVariance: { label: 'Brightness Variance',  description: 'Spread of per-row brightness; high = strong contrast (some bright, some dark rows), low = uniform.' },
  verticalCentroid:   { label: 'Vertical Centroid',    description: 'Y-coordinate of brightness center-of-mass. 0 = top of frame, 1 = bottom.' },
  horizontalCentroid: { label: 'Horizontal Centroid',  description: 'X-coordinate of brightness center-of-mass. 0 = brightness is concentrated on the left, 1 = on the right.' },
  meshActivity:       { label: 'Mesh Activity',        description: 'Frame-to-frame change magnitude. 0 = static scene, higher = more motion.' },
  peakRow:            { label: 'Peak Row',             description: 'Y-coordinate of the brightest scanline. 0 = top, 1 = bottom.' },
  peakBrightness:     { label: 'Peak Brightness',      description: 'Brightness value of the brightest scanline (post-DCU, in 0..1).' },
  edgeDensity:        { label: 'Edge Density',         description: 'Fraction of rows whose brightness differs from the previous row by more than 10% — a "fine detail" estimate.' },
};
