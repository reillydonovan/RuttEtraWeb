/**
 * Dual Raster panel section (v23, AUDIT items 8-11).
 *
 * Feature-flagged second raster: enable toggle, wipe/alternate mode,
 * the dual-trace slider, and raster B's independent deflection +
 * luminance controls. Everything here is inert while the flag is off —
 * the classic single-raster path is untouched.
 *
 * See docs/design/dual-raster.md for the architecture and the list of
 * params deliberately shared with raster A in v1 (scan, source, color).
 */

import { SettingsStore } from '../../state/Settings';
import { group, row, slider, toggle, dropdown } from '../widgets';

export function createDualRasterSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  const main = group('Dual Trace');
  main.body.append(
    row('Enable', toggle(settings, 'dualRasterEnabled', 'second raster (B)')),
    row('Mode', dropdown(settings, 'dualMode', [
      { value: 'wipe', label: 'Wipe (trace slider splits the frame)' },
      { value: 'alternate', label: 'Alternate lines (row interleave)' },
    ])),
    row('Trace', slider(settings, 'dualTracePos', 0, 1, 0.001), '0 = all A · 1 = all B'),
  );
  root.appendChild(main.root);

  const pos = group('B · Position & Size');
  pos.body.append(
    row('H Position', slider(settings, 'bHPos', -2, 2, 0.001)),
    row('V Position', slider(settings, 'bVPos', -2, 2, 0.001)),
    row('H Size',     slider(settings, 'bHSize', -2, 2, 0.001), 'negative inverts'),
    row('V Size',     slider(settings, 'bVSize', -2, 2, 0.001), 'negative inverts'),
    row('H Linearity', slider(settings, 'bHLinearity', -1, 1, 0.001)),
    row('V Linearity', slider(settings, 'bVLinearity', -1, 1, 0.001)),
  );
  root.appendChild(pos.root);

  const depth = group('B · Depth & Beam');
  depth.body.append(
    row('Z Push',    slider(settings, 'bZPush', -4, 4, 0.001)),
    row('Z Bias',    slider(settings, 'bZBias', -2, 2, 0.001)),
    row('Intensity', slider(settings, 'bIntensity', 0, 3, 0.001)),
  );
  root.appendChild(depth.root);

  const rot = group('B · Rotation');
  rot.body.append(
    row('H Center', slider(settings, 'bHCenter', -1, 1, 0.001)),
    row('V Center', slider(settings, 'bVCenter', -1, 1, 0.001)),
    row('H Spin',   slider(settings, 'bHSpin', -Math.PI, Math.PI, 0.001)),
    row('V Spin',   slider(settings, 'bVSpin', -Math.PI, Math.PI, 0.001)),
    row('Rotation', slider(settings, 'bRotation', -180, 180, 0.1), 'degrees'),
  );
  root.appendChild(rot.root);

  const lum = group('B · Luminance Shaping');
  lum.body.append(
    row('Threshold', slider(settings, 'bThreshold', 0, 1, 0.001)),
    row('Contrast',  slider(settings, 'bContrast', 0, 3, 0.001)),
    row('Gamma',     slider(settings, 'bGamma', 0.2, 3, 0.001)),
  );
  root.appendChild(lum.root);

  return root;
}
