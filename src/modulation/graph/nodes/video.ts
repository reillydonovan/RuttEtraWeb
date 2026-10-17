/**
 * Video CV nodes — read luminance / color / motion / edge density of a
 * region of the input video and turn it into a control signal.
 *
 * Stage 1 ships these as **stubs**: they're registered so the engine and
 * UI can see them, but they return 0 when no `VideoTap` service is
 * present in `ctx.deps`. Stage 5 fills in the actual readback path; the
 * node implementations only need to invoke `tap.*` methods.
 *
 * Region rectangles are stored on the node's `params` as `rx`, `ry`,
 * `rw`, `rh` in 0..1 normalized coords; defaults are full-frame.
 */

import { register } from '../registry';
import { Rect } from '../types';

const REGION_PARAMS = {
  rx: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 0, help: 'Left edge of the region to watch, as a fraction of frame width (0 = left edge).' },
  ry: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 0, help: 'Top edge of the region to watch, as a fraction of frame height (0 = top).' },
  rw: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 1, help: 'Width of the region to watch, as a fraction of the frame (1 = full width).' },
  rh: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 1, help: 'Height of the region to watch, as a fraction of the frame (1 = full height).' },
};

function rectFrom(params: Record<string, number | string | boolean>): Rect {
  return {
    x: +(params.rx as number),
    y: +(params.ry as number),
    w: +(params.rw as number),
    h: +(params.rh as number),
  };
}

// ---------- video-luma ----------

register<{}>({
  type: 'video-luma',
  category: 'Video',
  label: 'Video Luma',
  description: 'Average luminance of a region of the input video (0..1).',
  inputs: [],
  // Luma is 0..1, times Gain.
  outputs: [{ name: 'out', kind: 'video', range: (p) => { const g = +(p.gain ?? 1); return p.bipolar === true ? [-1, 2 * g - 1] : [0, g]; } }],
  params: {
    ...REGION_PARAMS,
    bipolar: { kind: 'boolean', default: false, help: 'ON maps brightness to -1..+1 (black is -1); OFF keeps it 0 to 1.' },
    gain:    { kind: 'number', min: 0, max: 4, step: 0.01, default: 1, help: 'Multiplies the brightness reading: above 1 makes dim video react more.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    const v = tap.getLumaRegion(rectFrom(params), false) * +(params.gain as number);
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- video-luma-row ----------

register<{}>({
  type: 'video-luma-row',
  category: 'Video',
  label: 'Video Row Luma',
  description: 'Average luminance of a single horizontal scanline.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'video', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) }],
  params: {
    y:       { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5, help: 'Which scanline to read, from 0 (top) to 1 (bottom).' },
    bipolar: { kind: 'boolean', default: false, help: 'ON maps the line’s brightness to -1..+1 (black is -1); OFF keeps it 0 to 1.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    const v = tap.getRow(+(params.y as number));
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- video-luma-col ----------

register<{}>({
  type: 'video-luma-col',
  category: 'Video',
  label: 'Video Column Luma',
  description: 'Average luminance of a single vertical column.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'video', range: (p) => (p.bipolar === true ? [-1, 1] : [0, 1]) }],
  params: {
    x:       { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5, help: 'Which column to read, from 0 (left) to 1 (right).' },
    bipolar: { kind: 'boolean', default: false, help: 'ON maps the column’s brightness to -1..+1 (black is -1); OFF keeps it 0 to 1.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    const v = tap.getCol(+(params.x as number));
    outputs.out = (params.bipolar as boolean) ? v * 2 - 1 : v;
  },
});

// ---------- video-motion ----------

register<{}>({
  type: 'video-motion',
  category: 'Video',
  label: 'Video Motion',
  description: 'Frame-difference magnitude over a region — detects movement.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'video', range: [0, 1] }],
  params: {
    ...REGION_PARAMS,
    gain: { kind: 'number', min: 0, max: 8, step: 0.01, default: 2, help: 'Boosts the motion reading so small movements register; the output tops out at 1.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    outputs.out = Math.min(1, tap.getMotionRegion(rectFrom(params)) * +(params.gain as number));
  },
});

// ---------- video-color ----------

register<{}>({
  type: 'video-color',
  category: 'Video',
  label: 'Video Color',
  description: 'Average HSV of a region — three outputs (h / s / v).',
  inputs: [],
  outputs: [
    { name: 'h', kind: 'video', range: [0, 1] },
    { name: 's', kind: 'video', range: [0, 1] },
    { name: 'v', kind: 'video', range: [0, 1] },
  ],
  params: { ...REGION_PARAMS },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.h = 0; outputs.s = 0; outputs.v = 0; return; }
    const c = tap.getColorRegion(rectFrom(params));
    outputs.h = c.h; outputs.s = c.s; outputs.v = c.v;
  },
});

// ---------- video-edge ----------

register<{}>({
  type: 'video-edge',
  category: 'Video',
  label: 'Video Edge',
  description: 'Sobel edge density over a region — high for detailed input.',
  inputs: [],
  outputs: [{ name: 'out', kind: 'video', range: [0, 1] }],
  params: {
    ...REGION_PARAMS,
    gain: { kind: 'number', min: 0, max: 8, step: 0.01, default: 2, help: 'Boosts the edge-detail reading so softer images still register; the output tops out at 1.' },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    outputs.out = Math.min(1, tap.getEdgeDensity(rectFrom(params)) * +(params.gain as number));
  },
});
