/**
 * Dual Raster panel section (v23, AUDIT items 8-11; third raster v36).
 *
 * Feature-flagged extra rasters: enable toggle, 2/3 raster-count switch,
 * wipe/alternate mode, the two trace sliders, the (unsaved) identify
 * tint, and raster B's and C's independent deflection + luminance
 * controls. Everything here is inert while the flag is off — the
 * classic single-raster path is untouched.
 *
 * See docs/design/dual-raster.md for the architecture and the list of
 * params deliberately shared with raster A (scan, source, color).
 */

import { SettingsStore } from '../../state/Settings';
import { group, row, slider, toggle, dropdown } from '../widgets';
import { createRasterIdentifyToggle } from '../rasterIdentifyToggle';

type RasterPrefix = 'b' | 'c';

/** The per-raster groups (Position & Size / Depth & Beam / Rotation /
 *  Luminance Shaping) for raster B or C — one builder, since the two
 *  rasters carry the identical 17-param set under different prefixes. */
function rasterGroups(settings: SettingsStore, p: RasterPrefix): HTMLElement[] {
  const L = p.toUpperCase();
  // The b*/c* keys are real `Settings` number keys; the template literal
  // just can't be narrowed by TS, so assert through `never`.
  const k = (name: string): never => `${p}${name}` as never;

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
    row('Z Push',    slider(settings, k('ZPush'), -4, 4, 0.001)),
    row('Z Bias',    slider(settings, k('ZBias'), -2, 2, 0.001)),
    row('Intensity', slider(settings, k('Intensity'), 0, 3, 0.001)),
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
    row('Contrast',  slider(settings, k('Contrast'), 0, 3, 0.001)),
    row('Gamma',     slider(settings, k('Gamma'), 0.2, 3, 0.001)),
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
