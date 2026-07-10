/**
 * Pure geometry + interaction math for the automation-lane editor.
 *
 * No DOM — everything here is node-testable. The LaneRow component is a
 * thin shell over these functions: it feeds pointer deltas in and paints
 * whatever comes out.
 *
 * Coordinate conventions:
 *   - x: bars → pixels via pixelsPerBar (same scale as ruler/track).
 *   - y: lane offsets → pixels within a row of `rowHeight` px, value 0
 *     always at the vertical center (offsets sum onto base; 0 = no
 *     offset). Positive offsets draw upward.
 */

import { AutomationPoint, EasingType } from '../../sequencer/types';
import { evalLane } from '../../sequencer/lanes';

export interface LaneAxis {
  /** Bottom of the axis (most negative offset). */
  min: number;
  /** Top of the axis (most positive offset). Always === -min. */
  max: number;
}

/**
 * Symmetric value axis for a lane row. Half-range is the larger of half
 * the param's designed span (so a full-scale sweep fits) and 1.1× the
 * largest point magnitude (so hand-authored outliers never clip).
 * Falls back to ±1 when the span is unknown or degenerate.
 */
export function laneAxis(designedSpan: number | null, points: AutomationPoint[]): LaneAxis {
  let half = designedSpan != null && designedSpan > 0 ? designedSpan / 2 : 1;
  for (const p of points) {
    const need = Math.abs(p.value) * 1.1;
    if (need > half) half = need;
  }
  return { min: -half, max: half };
}

export function barToX(bar: number, pixelsPerBar: number): number {
  return bar * pixelsPerBar;
}

export function xToBar(x: number, pixelsPerBar: number, lengthBars: number): number {
  return Math.max(0, Math.min(lengthBars, x / pixelsPerBar));
}

export function valueToY(value: number, axis: LaneAxis, rowHeight: number): number {
  const t = (axis.max - value) / (axis.max - axis.min); // 0 at top, 1 at bottom
  return Math.max(0, Math.min(rowHeight, t * rowHeight));
}

export function yToValue(y: number, axis: LaneAxis, rowHeight: number): number {
  const t = Math.max(0, Math.min(1, y / rowHeight));
  return axis.max - t * (axis.max - axis.min);
}

/** Same beat rounding as TimelineTrack's keyframe drag. */
export function snapBarToBeat(bar: number, beatsPerBar: number): number {
  const beats = bar * beatsPerBar;
  return Math.round(beats) / beatsPerBar;
}

/**
 * Find the point at `bar` within `eps`. UI code MUST pass the returned
 * point's own exact `.bar` to `removePointAt`/`upsertPoint` — the data
 * layer compares bars with strict equality and a float playhead
 * (0.9999999) would otherwise silently miss.
 */
export function findPointAt(
  points: AutomationPoint[],
  bar: number,
  eps = 1e-6,
): AutomationPoint | null {
  for (const p of points) {
    if (Math.abs(p.bar - bar) <= eps) return p;
  }
  return null;
}

/** Sample a lane's curve for stroking. Returns [bar, value] pairs including both endpoints. */
export function sampleLane(
  points: AutomationPoint[],
  fromBar: number,
  toBar: number,
  stepBars: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (toBar <= fromBar || stepBars <= 0) return out;
  for (let b = fromBar; b < toBar; b += stepBars) {
    out.push([b, evalLane(points, b)]);
  }
  out.push([toBar, evalLane(points, toBar)]);
  return out;
}

export interface DragResult {
  bar: number;
  value: number;
}

/**
 * Where a dragged point lands given pointer deltas. Horizontal beat-snaps
 * unless `free`; vertical maps through the axis; both clamp to the lane's
 * domain. `startBar`/`startValue` are the point's position at drag start.
 */
export function dragResult(
  startBar: number,
  startValue: number,
  dxPx: number,
  dyPx: number,
  opts: {
    pixelsPerBar: number;
    rowHeight: number;
    axis: LaneAxis;
    beatsPerBar: number;
    lengthBars: number;
    free: boolean;
  },
): DragResult {
  let bar = startBar + dxPx / opts.pixelsPerBar;
  if (!opts.free) bar = snapBarToBeat(bar, opts.beatsPerBar);
  bar = Math.max(0, Math.min(opts.lengthBars, bar));

  const startY = valueToY(startValue, opts.axis, opts.rowHeight);
  const value = yToValue(startY + dyPx, opts.axis, opts.rowHeight);
  return { bar, value };
}

export type { EasingType };
