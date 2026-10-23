/**
 * Pure geometry + interaction math for the automation-lane editor.
 *
 * No DOM — everything here is node-testable. The LaneRow component is a
 * thin shell over these functions: it feeds pointer deltas in and paints
 * whatever comes out.
 *
 * Coordinate conventions:
 *   - x: bars → pixels via pixelsPerBar (same scale as ruler/track).
 *   - y: ABSOLUTE param values → pixels within a row of `rowHeight` px.
 *     The axis spans the param's slider range (traditional keyframe-
 *     editor presentation: what you see is the value at that bar, and
 *     it matches the panel knob's readout). Points are still STORED as
 *     offsets from the base; LaneRow converts at the boundary.
 */

import { AutomationPoint, EasingType } from '../../sequencer/types';
import { evalLane } from '../../sequencer/lanes';

export interface LaneAxis {
  /** Bottom of the axis (lowest absolute value shown). */
  min: number;
  /** Top of the axis (highest absolute value shown). */
  max: number;
}

/**
 * Absolute value axis for a lane row: the param's effective slider
 * range (user override > designed bounds), expanded when a point's
 * resolved value (base + offset) falls outside it so hand-authored
 * outliers never clip. Falls back to base ± 1 when the range is
 * unknown or degenerate.
 */
export function laneAxisAbs(
  range: { min: number; max: number } | null,
  base: number,
  points: AutomationPoint[],
): LaneAxis {
  let lo: number, hi: number;
  if (range && range.max > range.min) {
    lo = range.min;
    hi = range.max;
  } else {
    lo = base - 1;
    hi = base + 1;
  }
  const pad = (hi - lo) * 0.05;
  for (const p of points) {
    const v = base + p.value;
    if (v - pad < lo) lo = v - pad;
    if (v + pad > hi) hi = v + pad;
  }
  return { min: lo, max: hi };
}

// Pointer → local-pixel helpers live in ui/screenScale.ts (shared with the graph editor).
export { screenScale, localX } from '../screenScale';

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
