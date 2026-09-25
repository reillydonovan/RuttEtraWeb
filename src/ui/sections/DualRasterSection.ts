/**
 * Dual Raster panel section (v23, AUDIT items 8-11; third raster v36).
 *
 * Feature-flagged extra rasters: enable toggle, 2/3 raster-count switch,
 * wipe/alternate mode, the two trace sliders, the (unsaved) identify
 * tint, and every raster's deflection + luminance controls: A's rows
 * are a second view onto the main DCU keys, B's and C's are their own
 * b* / c* keys. B/C controls are inert while the flag is off (the
 * classic single-raster path is untouched); A's rows always drive
 * raster A, exactly like the DCU section.
 *
 * See docs/design/dual-raster.md for the architecture and the list of
 * params deliberately shared with raster A (scan, source, color).
 */

import { SettingsStore } from '../../state/Settings';
import { group, row, slider, toggle, dropdown } from '../widgets';
import { createRasterIdentifyToggle } from '../rasterIdentifyToggle';

type Raster = 'a' | 'b' | 'c';

/** Settings key for one raster param. Raster A's params are the main
 *  DCU keys (`hPos`, `zPush`, …); B and C use `b`/`c`-prefixed copies
 *  (`bHPos`, `cZPush`, …). The keys are real `Settings` number keys; the
 *  string can't be narrowed by TS, so assert through `never`. */
function rasterKey(r: Raster, name: string): never {
  return (r === 'a' ? name[0].toLowerCase() + name.slice(1) : `${r}${name}`) as never;
}

/** Slider ranges that differ per raster. Raster A matches the Display
 *  Control Unit section's sliders exactly (the same keys, so the two
 *  rows must agree); B and C keep their v23 ranges. */
const RANGES: Record<Raster, { zPush: [number, number]; intensity: [number, number]; contrast: [number, number]; gamma: [number, number] }> = {
  a: { zPush: [0, 4],  intensity: [0, 2], contrast: [0, 4], gamma: [0.2, 4] },
  b: { zPush: [-4, 4], intensity: [0, 3], contrast: [0, 3], gamma: [0.2, 3] },
  c: { zPush: [-4, 4], intensity: [0, 3], contrast: [0, 3], gamma: [0.2, 3] },
};

/** The per-raster groups (Position & Size / Depth & Beam / Rotation /
 *  Luminance Shaping) for raster A, B or C — one builder for all three.
 *  Raster A's rows are a second view onto the same Settings keys the
 *  Display Control Unit section edits (not a copy of the state), so
 *  every raster's controls sit side by side here. */
function rasterGroups(settings: SettingsStore, r: Raster): HTMLElement[] {
  const L = r.toUpperCase();
  const k = (name: string): never => rasterKey(r, name);
  const rg = RANGES[r];

  const pos = group(`${L} · Position & Size`);
  pos.body.append(
    row('H Position', slider(settings, k('HPos'), -2, 2, 0.001)),
    row('V Position', slider(settings, k('VPos'), -2, 2, 0.001)),
    row('H Size',     slider(settings, k('HSize'), -2, 2, 0.001), 'negative inverts'),
    row('V Size',     slider(settings, k('VSize'), -2, 2, 0.001), 'negative inverts'),
    row('H Linearity', slider(settings, k('HLinearity'), -1, 1, 0.001)),
    row('V Linearity', slider(settings, k('VLinearity'), -1, 1, 0.001)),
  );

  const depth = group(`${L} · Depth & Beam`);
  depth.body.append(
    row('Z Push',    slider(settings, k('ZPush'), rg.zPush[0], rg.zPush[1], 0.001)),
    row('Z Bias',    slider(settings, k('ZBias'), -2, 2, 0.001)),
    row('Intensity', slider(settings, k('Intensity'), rg.intensity[0], rg.intensity[1], 0.001)),
  );

  const rot = group(`${L} · Rotation`);
  rot.body.append(
    row('H Center', slider(settings, k('HCenter'), -1, 1, 0.001)),
    row('V Center', slider(settings, k('VCenter'), -1, 1, 0.001)),
    row('H Spin',   slider(settings, k('HSpin'), -Math.PI, Math.PI, 0.001)),
    row('V Spin',   slider(settings, k('VSpin'), -Math.PI, Math.PI, 0.001)),
    row('Rotation', slider(settings, k('Rotation'), -180, 180, 0.1), 'degrees'),
  );

  const lum = group(`${L} · Luminance Shaping`);
  lum.body.append(
    row('Threshold', slider(settings, k('Threshold'), 0, 1, 0.001)),
    row('Contrast',  slider(settings, k('Contrast'), rg.contrast[0], rg.contrast[1], 0.001)),
    row('Gamma',     slider(settings, k('Gamma'), rg.gamma[0], rg.gamma[1], 0.001)),
  );

  return [pos.root, depth.root, rot.root, lum.root];
}

export function createDualRasterSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  const main = group('Dual Trace');
  const trace2Row = row('Trace 2', slider(settings, 'dualTracePos2', 0, 1, 0.001), 'C grows from the top · 0 = no C');
  main.body.append(
    row('Enable', toggle(settings, 'dualRasterEnabled', 'extra rasters')),
    row('Rasters', dropdown(settings, 'dualRasterCount', [
      { value: 2, label: '2 (A + B)' },
      { value: 3, label: '3 (A + B + C)' },
    ])),
    row('Mode', dropdown(settings, 'dualMode', [
      { value: 'wipe', label: 'Wipe (trace sliders split the frame)' },
      { value: 'alternate', label: 'Alternate lines (row interleave)' },
    ])),
    row('Trace', slider(settings, 'dualTracePos', 0, 1, 0.001), 'B grows from the top · 0 = all A'),
    trace2Row,
    row('Identify', createRasterIdentifyToggle()),
  );
  root.appendChild(main.root);

  // Raster A first — the same controls as the Display Control Unit
  // section, repeated here so A, B and C read side by side.
  for (const el of rasterGroups(settings, 'a')) root.appendChild(el);
  for (const el of rasterGroups(settings, 'b')) root.appendChild(el);
  const cGroups = rasterGroups(settings, 'c');
  for (const el of cGroups) root.appendChild(el);

  // Raster C's controls only show while 3 rasters are selected — with 2
  // they'd be knobs for something that isn't drawn.
  settings.subscribe('dualRasterCount', (n) => {
    const three = n === 3;
    // Inline display (not `hidden`): `.rw-row`/`.rw-group` set their own
    // display in panel.css, which outranks the UA [hidden] rule.
    trace2Row.style.display = three ? '' : 'none';
    for (const el of cGroups) el.style.display = three ? '' : 'none';
  });

  return root;
}
