/**
 * Geometry section — render mode and resolution.
 * (Cols / scan-rate also live in the DCU section but we expose render mode here.)
 */

import { SettingsStore } from '../../state/Settings';
import { row, group, dropdown } from '../widgets';

export function createGeometrySection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  const mode = group('Render Mode');
  mode.body.append(
    row('Mode', dropdown(settings, 'renderMode', [
      { value: 'scanlines', label: 'Scan Lines (additive)' },
      { value: 'wireframe', label: 'Wireframe (opaque)' },
      { value: 'dots',      label: 'Dot Raster (experimental)' },
    ])),
  );
  root.appendChild(mode.root);

  const note = document.createElement('div');
  note.className = 'rw-hint';
  note.style.padding = '6px 0';
  note.innerHTML = 'Resolution lives in the <b>DCU > Scan</b> group: <i>Scan Rate</i> = rows, <i>Cols</i> = samples per row. Total verts = rows × cols × 2.';
  root.appendChild(note);

  return root;
}
