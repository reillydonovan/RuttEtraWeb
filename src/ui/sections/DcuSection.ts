/**
 * Display Control Unit — every native Rutt/Etra DCU control.
 * Maps 1:1 to the original hardware panel layout.
 */

import { SettingsStore } from '../../state/Settings';
import { row, group, slider, toggle, button } from '../widgets';

export function createDcuSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  // ---- Position & Size ----
  const pos = group('Position & Size');
  pos.body.append(
    row('H Position',  slider(settings, 'hPos',  -2, 2, 0.001)),
    row('V Position',  slider(settings, 'vPos',  -2, 2, 0.001)),
    row('H Size',      slider(settings, 'hSize', -2, 2, 0.001), 'negative inverts'),
    row('V Size',      slider(settings, 'vSize', -2, 2, 0.001), 'negative inverts'),
    row('Aspect',      slider(settings, 'aspect', 0.25, 4, 0.001)),
  );
  root.appendChild(pos.root);

  // ---- Depth (Z) ----
  const depth = group('Depth (Z) — Brightness Displacement');
  depth.body.append(
    row('Z Push',   slider(settings, 'zPush', 0, 4, 0.001)),
    row('Z Bias',   slider(settings, 'zBias', -2, 2, 0.001)),
    row('Z Invert', toggle(settings, 'zInvert', 'push dark instead of bright')),
  );
  root.appendChild(depth.root);

  // ---- Beam ----
  const beam = group('Beam');
  beam.body.append(
    row('Intensity', slider(settings, 'intensity', 0, 2, 0.001)),
    row('Focus',     slider(settings, 'focus',     0, 1, 0.001), '0=sharp, 1=soft'),
  );
  root.appendChild(beam.root);

  // ---- Rotation / Spin / Reverse ----
  const rot = group('Rotation');
  rot.body.append(
    row('H Center',   slider(settings, 'hCenter', -1, 1, 0.001)),
    row('V Center',   slider(settings, 'vCenter', -1, 1, 0.001)),
    row('H Spin',     slider(settings, 'hSpin', -Math.PI, Math.PI, 0.001)),
    row('V Spin',     slider(settings, 'vSpin', -Math.PI, Math.PI, 0.001)),
    row('H Spin Rate', slider(settings, 'hSpinRate', -2, 2, 0.001), 'auto-rotation rad/s'),
    row('V Spin Rate', slider(settings, 'vSpinRate', -2, 2, 0.001), 'auto-rotation rad/s'),
    row('H Reverse',  toggle(settings, 'hReverse', 'flip across H axis')),
    row('V Reverse',  toggle(settings, 'vReverse', 'flip across V axis')),
    row('Display 0/90', toggle(settings, 'rotate90', 'rotate raster 90 degrees')),
  );

  const stopSpinBtn = button('Stop All Spin', () => {
    settings.set('hSpin', 0);
    settings.set('vSpin', 0);
    settings.set('hSpinRate', 0);
    settings.set('vSpinRate', 0);
  });
  const spinBtnRow = document.createElement('div');
  spinBtnRow.className = 'rw-btn-row';
  spinBtnRow.appendChild(stopSpinBtn);
  rot.body.appendChild(spinBtnRow);
  root.appendChild(rot.root);

  // ---- Scan ----
  const scan = group('Scan');
  scan.body.append(
    row('Scan Rate', slider(settings, 'scanRate', 30, 600, 1), 'rows per frame'),
    row('Cols',      slider(settings, 'cols',     30, 600, 1), 'samples per row'),
    row('Skip',      slider(settings, 'skip',      0, 0.95, 0.001), 'fraction of lines dropped'),
  );
  root.appendChild(scan.root);

  // ---- Linearity ----
  const lin = group('Linearity');
  lin.body.append(
    row('H Linearity', slider(settings, 'hLinearity', -1, 1, 0.001), 'pin/barrel bow X'),
    row('V Linearity', slider(settings, 'vLinearity', -1, 1, 0.001), 'pin/barrel bow Y'),
  );
  root.appendChild(lin.root);

  // ---- Luminance shaping ----
  const lum = group('Luminance Shaping');
  lum.body.append(
    row('Threshold', slider(settings, 'threshold', 0, 1, 0.001), 'key out below'),
    row('Contrast',  slider(settings, 'contrast',  0, 4, 0.001)),
    row('Gamma',     slider(settings, 'gamma',     0.2, 4, 0.001)),
  );
  root.appendChild(lum.root);

  // ---- Reset DCU ----
  const resetRow = document.createElement('div');
  resetRow.className = 'rw-btn-row';
  resetRow.appendChild(button('Reset DCU', () => {
    settings.patch({
      hPos: 0, vPos: 0, hSize: 1, vSize: 1, aspect: 4 / 3,
      zPush: 0.9, zBias: 0, zInvert: false,
      intensity: 1, focus: 0,
      hCenter: 0, vCenter: 0,
      hSpin: 0, vSpin: 0, hSpinRate: 0, vSpinRate: 0,
      hReverse: false, vReverse: false, rotate90: false,
      scanRate: 240, cols: 320,
      hLinearity: 0, vLinearity: 0,
      skip: 0, threshold: 0.04, contrast: 1, gamma: 1,
    });
  }));
  root.appendChild(resetRow);

  return root;
}
