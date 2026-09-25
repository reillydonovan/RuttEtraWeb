/**
 * "Identify rasters" toggle (v1.29) — one builder shared by the Controls
 * tab's Dual Raster section and the Patch Bay's DUAL RASTER module, so
 * both surfaces show the same control bound to the same (unsaved) state
 * in `src/renderer/rasterIdentify.ts`.
 *
 * Styled like the panel's Settings-bound `toggle()` widget, but NOT
 * bound to Settings: the tint is a setup aid that must never be saved or
 * reach an output. While any output is active the note explains why the
 * tint isn't showing, instead of silently ignoring the checkbox
 * (principle 3 — no silent fallbacks).
 */

import {
  isAnyOutputActive,
  isIdentifyRequested,
  setIdentifyRequested,
  subscribeIdentifyState,
} from '../renderer/rasterIdentify';

export function createRasterIdentifyToggle(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-identify';

  const lab = document.createElement('label');
  lab.className = 'rw-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  const sw = document.createElement('span');
  sw.className = 'rw-toggle-sw';
  const txt = document.createElement('span');
  txt.className = 'rw-toggle-txt';
  txt.textContent = 'tint A / B / C';
  lab.append(cb, sw, txt);

  const note = document.createElement('div');
  note.className = 'rw-hint rw-identify-note';

  const sync = (): void => {
    cb.checked = isIdentifyRequested();
    const paused = cb.checked && isAnyOutputActive();
    note.textContent = paused
      ? 'Paused while recording, streaming, or the render window is popped out.'
      : 'Setup aid only. Never saved, never recorded or streamed.';
  };
  cb.addEventListener('change', () => setIdentifyRequested(cb.checked));
  // Module-lifetime subscription: panel sections live as long as the app.
  subscribeIdentifyState(sync);
  sync();

  wrap.append(lab, note);
  return wrap;
}
