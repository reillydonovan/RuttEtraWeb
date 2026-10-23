/**
 * WebXR control section (v11).
 *
 * Surfaces the headset session lifecycle to the user:
 *
 *   - Status line (live: "Not in session" / "In immersive-vr session — …")
 *   - Enter VR / Enter AR buttons (only the supported ones are shown)
 *   - Exit XR button (visible while a session is active)
 *   - Mesh scale dropdown (tabletop / roomscale / architectural)
 *   - Performance dropdown (auto / quality / balanced / battery)
 *   - "Detected" capability line
 *   - One-shot pre-session safety overlay on the first start of a
 *     page load, dismissible per Principle 4 (audio safety extended
 *     to physical XR).
 *
 * Compact-mode and unsupported-browser variants degrade gracefully:
 * the section explains why XR isn't available rather than showing
 * dead buttons (Principle 3: surface state, don't hide it).
 *
 * The active session mode itself lives on `XRManager`, NOT in
 * `Settings`. This section reads it through the manager's getters
 * and subscribes to start/end events for status updates.
 */

import { SettingsStore } from '../../state/Settings';
import { XRManager, XRSupport, XrSessionMode } from '../../renderer/XRManager';
import { row, group, dropdown, button, readout } from '../widgets';

export function createXrSection(settings: SettingsStore, xr: XRManager): HTMLElement {
  const root = document.createElement('div');

  // Compact mode: this v1 expects desktop-tethered headsets, not
  // phone-as-cardboard. Explain why and exit early so the user
  // doesn't see dead controls.
  if (document.body.dataset.layout === 'compact') {
    const compact = group('XR');
    const note = document.createElement('div');
    note.className = 'rw-note';
    note.textContent =
      'WebXR is available on desktop browsers with a connected headset. This view doesn\'t support XR sessions directly.';
    compact.body.append(note);
    root.appendChild(compact.root);
    return root;
  }

  // -------------------- Status group --------------------
  const statusGroup = group('XR');
  const statusEl = readout();
  statusEl.textContent = 'Status: Not in session';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'rw-btn-row';

  const vrBtn = button('Enter VR', () => void enter('immersive-vr'), 'primary');
  const arBtn = button('Enter AR', () => void enter('immersive-ar'));
  const exitBtn = button('Exit XR', () => void xr.endSession());

  buttonRow.append(vrBtn, arBtn, exitBtn);

  statusGroup.body.append(row('Status', statusEl), buttonRow);
  root.appendChild(statusGroup.root);

  // -------------------- Framing + performance group --------------------
  const cfg = group('Configuration');
  cfg.body.append(
    row(
      'Mesh scale',
      dropdown(settings, 'xrMeshScale', [
        { value: 'tabletop',      label: 'Tabletop (~desk model)' },
        { value: 'roomscale',     label: 'Roomscale (walk through)' },
        { value: 'architectural', label: 'Architectural (large, stand still)' },
      ]),
      'How big the mesh appears in headset.',
    ),
    row(
      'Performance',
      dropdown(settings, 'xrPerformanceProfile', [
        { value: 'auto',     label: 'Auto (detect headset)' },
        { value: 'quality',  label: 'Quality' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'battery',  label: 'Battery' },
      ]),
      'Framebuffer scale + foveation in XR.',
    ),
  );
  root.appendChild(cfg.root);

  // -------------------- Capability line --------------------
  const capGroup = group('Device');
  const capEl = readout();
  capEl.textContent = 'Detecting…';
  const recheckBtn = button('Check again', () => probe());
  capGroup.body.append(row('WebXR', capEl), recheckBtn);
  root.appendChild(capGroup.root);

  let support: XRSupport = { vr: false, ar: false };

  function applySupport(s: XRSupport): void {
    support = s;
    refreshButtons();
    refreshCapLine();
  }

  function refreshCapLine(): void {
    if (!support.vr && !support.ar) {
      // Say WHY, most specific first (Principle 3).
      if (!window.isSecureContext) {
        capEl.textContent =
          'WebXR needs a secure page: open the app over https:// or http://localhost (not a LAN IP over http).';
      } else if (!(navigator as Navigator & { xr?: unknown }).xr) {
        capEl.textContent =
          'This browser has no WebXR. Use Chrome or Edge on the PC, or the Meta Quest Browser in the headset.';
      } else {
        capEl.textContent =
          'No headset found. For a PC-tethered Quest: start Quest Link / Air Link, set Meta Quest Link as the active OpenXR runtime (Meta Quest Link app ▸ Settings ▸ General), then Check again.';
      }
      return;
    }
    const parts: string[] = [];
    if (support.vr) parts.push('VR supported');
    if (support.ar) parts.push('AR supported');
    capEl.textContent = parts.join(' · ');
  }

  function refreshButtons(): void {
    const active = xr.isActive;
    vrBtn.style.display  = support.vr ? '' : 'none';
    arBtn.style.display  = support.ar ? '' : 'none';
    exitBtn.style.display = active ? '' : 'none';
    (vrBtn as HTMLButtonElement).disabled = active || !support.vr;
    (arBtn as HTMLButtonElement).disabled = active || !support.ar;
  }

  function refreshStatus(): void {
    const mode = xr.sessionMode;
    if (mode === null) {
      statusEl.textContent = 'Not in session';
    } else {
      const verb = mode === 'immersive-ar' ? 'AR' : 'VR';
      statusEl.textContent = `In ${verb} session — remove headset or click Exit XR to end.`;
    }
    refreshButtons();
  }

  // Probe on build, on the browser's XR devicechange event (a headset
  // connected or Link started after the page loaded), and on demand
  // through Check again.
  function probe(): void {
    capEl.textContent = 'Detecting…';
    void xr.getSupport().then(applySupport);
  }
  probe();
  (navigator as Navigator & { xr?: EventTarget }).xr?.addEventListener?.('devicechange', probe);

  xr.onSessionStart(refreshStatus);
  xr.onSessionEnd(refreshStatus);

  refreshStatus();

  // -------------------- Pre-session safety overlay --------------------
  // First start per page load shows a brief, dismissible reminder.
  // After dismissal, doesn't show again until next page load.
  let shownThisLoad = false;
  async function enter(mode: XrSessionMode): Promise<void> {
    if (xr.isActive) return;
    if (!shownThisLoad) {
      shownThisLoad = true;
      const dismissed = await showSafetyOverlay();
      if (!dismissed) return;
    }
    try {
      await xr.startSession(mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start XR session';
      statusEl.textContent = `XR error: ${msg}`;
    }
  }

  return root;
}

/**
 * Pre-session safety overlay. Resolves to `true` if the user clicked
 * Continue, `false` if they dismissed. The "Cancel" / Escape path
 * aborts the session start — Principle 4 says XR enters only on
 * explicit user gesture, and a dismissed reminder is the user
 * pulling that gesture back.
 */
function showSafetyOverlay(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.78)',
      'z-index:1100', 'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const dialog = document.createElement('div');
    dialog.style.cssText = [
      'background:rgba(15,25,15,0.96)', 'color:#cfeacf',
      'border:1px solid rgba(160,200,160,0.5)', 'border-radius:8px',
      'padding:18px 22px', 'max-width:420px', 'font-family:VT323,monospace',
      'font-size:15px', 'line-height:1.45', 'box-shadow:0 6px 30px rgba(0,0,0,0.6)',
    ].join(';');
    dialog.innerHTML = `
      <div style="font-size:18px;margin-bottom:8px;">Starting XR session</div>
      <div style="margin-bottom:14px;">
        Make sure your headset is comfortable and your physical area is clear of obstacles.
        The desktop window stays editable — alt-tab or reach over to adjust the synth.
      </div>
    `;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:10px; justify-content:flex-end;';
    const cancel = button('Cancel', () => done(false));
    const cont = button('Continue', () => done(true), 'primary');
    btnRow.append(cancel, cont);
    dialog.appendChild(btnRow);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter')  done(true);
    };
    document.addEventListener('keydown', onKey);

    function done(ok: boolean): void {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(ok);
    }
  });
}
