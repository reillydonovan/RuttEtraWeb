/**
 * ?debug=mod overlay.
 *
 * Renders a compact, fixed-position panel showing every currently
 * modulated param key with its base value, live value, and the
 * modulation delta (`live - base`). Used to verify the base/live split:
 * the `base` column must update INSTANTLY when the user drags the
 * matching UI knob, and the `mod` column must reach EXACTLY 0 when
 * every contribution is zero. If the mod column never goes to 0, there's
 * a stale write somewhere — the overlay is the diagnostic for finding
 * it.
 *
 * Activation: `?debug=mod` URL flag. The overlay is invisible otherwise
 * and produces no runtime cost when the flag is absent (we early-return
 * from `attachIfRequested` without subscribing to anything).
 */

import { LiveValuesStore } from './LiveValues';

const STYLE_ID = 'rw-mod-debug-style';
const PANEL_ID = 'rw-mod-debug';

const STYLE_CSS = `
#${PANEL_ID} {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 9999;
  background: rgba(0, 12, 8, 0.85);
  color: #b9ffd0;
  font-family: 'VT323', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.2;
  padding: 8px 10px;
  border: 1px solid #2dff85;
  border-radius: 4px;
  pointer-events: none;
  min-width: 220px;
  max-width: 360px;
  box-shadow: 0 0 16px rgba(45, 255, 133, 0.25);
}
#${PANEL_ID} .rw-mod-debug-title {
  color: #5fff85;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
  border-bottom: 1px solid #2dff85;
  padding-bottom: 2px;
}
#${PANEL_ID} .rw-mod-debug-row {
  display: grid;
  grid-template-columns: 8em 6em 6em 6em;
  gap: 4px;
}
#${PANEL_ID} .rw-mod-debug-key { color: #ffe58f; }
#${PANEL_ID} .rw-mod-debug-empty { opacity: 0.55; font-style: italic; }
`;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return 'NaN';
  if (Math.abs(n) < 1e-4) return n === 0 ? '0' : n.toExponential(2);
  return n.toFixed(4);
}

export function attachModDebugOverlayIfRequested(live: LiveValuesStore): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get('debug');
  if (!flag || !flag.split(',').map((s) => s.trim()).includes('mod')) return;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'off');

  const title = document.createElement('div');
  title.className = 'rw-mod-debug-title';
  title.textContent = 'mod • base / live / Δ';
  panel.appendChild(title);

  const body = document.createElement('div');
  panel.appendChild(body);

  document.body.appendChild(panel);

  // Refresh at ~30Hz. Reading from `live` is cheap (Map lookups), and
  // the overlay's purpose is to verify per-frame correctness, so a
  // higher rate would only catch transient glitches the user can't see.
  const tick = (): void => {
    const keys = [...live.modulatedKeys()].sort();
    if (keys.length === 0) {
      body.innerHTML = '<div class="rw-mod-debug-empty">no modulated params</div>';
    } else {
      const rows: string[] = [];
      for (const k of keys) {
        const base = live.getBase(k);
        const liveV = live.getLive(k);
        const mod = liveV - base;
        rows.push(
          `<div class="rw-mod-debug-row">`
          + `<span class="rw-mod-debug-key">${k}</span>`
          + `<span>${fmt(base)}</span>`
          + `<span>${fmt(liveV)}</span>`
          + `<span>${fmt(mod)}</span>`
          + `</div>`,
        );
      }
      body.innerHTML = rows.join('');
    }
  };
  tick();
  setInterval(tick, 1000 / 30);
}
