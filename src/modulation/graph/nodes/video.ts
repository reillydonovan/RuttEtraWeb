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
  rx: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 0 },
  ry: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 0 },
  rw: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 1 },
  rh: { kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 1 },
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
  outputs: [{ name: 'out', kind: 'video' }],
  params: {
    ...REGION_PARAMS,
    bipolar: { kind: 'boolean', default: false },
    gain:    { kind: 'number', min: 0, max: 4, step: 0.01, default: 1 },
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
  outputs: [{ name: 'out', kind: 'video' }],
  params: {
    y:       { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
    bipolar: { kind: 'boolean', default: false },
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
  outputs: [{ name: 'out', kind: 'video' }],
  params: {
    x:       { kind: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
    bipolar: { kind: 'boolean', default: false },
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
  outputs: [{ name: 'out', kind: 'video' }],
  params: {
    ...REGION_PARAMS,
    gain: { kind: 'number', min: 0, max: 8, step: 0.01, default: 2 },
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
    { name: 'h', kind: 'video' },
    { name: 's', kind: 'video' },
    { name: 'v', kind: 'video' },
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
  outputs: [{ name: 'out', kind: 'video' }],
  params: {
    ...REGION_PARAMS,
    gain: { kind: 'number', min: 0, max: 8, step: 0.01, default: 2 },
  },
  init: () => ({}),
  tick(ctx, _s, _i, params, outputs) {
    const tap = ctx.deps.videoTap;
    if (!tap) { outputs.out = 0; return; }
    outputs.out = Math.min(1, tap.getEdgeDensity(rectFrom(params)) * +(params.gain as number));
  },
});
