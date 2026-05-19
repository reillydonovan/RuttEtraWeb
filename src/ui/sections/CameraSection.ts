/**
 * Camera section — orbit/fly mode toggle, FOV/near/far, auto-orbit,
 * Reset View, Save Default View, and a numeric readout of the current
 * camera transform. Also exposes the render-resolution selector.
 */

import { SettingsStore } from '../../state/Settings';
import { CameraRig } from '../../renderer/CameraRig';
import { RESOLUTION_PRESETS } from '../../renderer/ResolutionManager';
import { row, group, slider, toggle, dropdown, button, readout } from '../widgets';

export function createCameraSection(settings: SettingsStore, rig: CameraRig): HTMLElement {
  const root = document.createElement('div');

  const modeRow = group('Mode');
  const modeDd = dropdown(settings, 'cameraMode', [
    { value: 'orbit', label: 'Orbit (drag to rotate)' },
    { value: 'fly',   label: 'Fly (WASD + mouse)' },
  ]) as HTMLSelectElement;
  // Fly mode is hidden + disabled on compact (no pointer-lock on phones).
  const updateFlyOpt = () => {
    const compact = document.body.dataset.layout === 'compact';
    const flyOpt = Array.from(modeDd.options).find((o) => o.value === 'fly');
    if (flyOpt) flyOpt.disabled = compact;
    if (compact && settings.get('cameraMode') === 'fly') {
      settings.set('cameraMode', 'orbit');
    }
  };
  updateFlyOpt();
  // Re-evaluate on layout-mode change.
  const obs = new MutationObserver(updateFlyOpt);
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });
  modeRow.body.append(row('Mode', modeDd));
  root.appendChild(modeRow.root);

  // ---- Resolution group ----
  root.appendChild(buildResolutionGroup(settings));

  const lens = group('Lens');
  lens.body.append(
    row('FOV',   slider(settings, 'cameraFov',  10, 120, 0.5)),
    row('Near',  slider(settings, 'cameraNear', 0.001, 2, 0.001)),
    row('Far',   slider(settings, 'cameraFar',  5, 500, 1)),
  );
  root.appendChild(lens.root);

  const auto = group('Auto-orbit');
  auto.body.append(
    row('Auto-orbit', toggle(settings, 'autoOrbit', 'slow camera spin')),
    row('Speed',      slider(settings, 'autoOrbitSpeed', -2, 2, 0.001)),
  );
  root.appendChild(auto.root);

  const fly = group('Fly settings');
  fly.body.append(
    row('Speed', slider(settings, 'flySpeed', 0.1, 10, 0.05)),
    row('Boost', slider(settings, 'flyBoost', 1, 20, 0.1), 'multiplier with Shift'),
  );
  root.appendChild(fly.root);

  const btns = document.createElement('div');
  btns.className = 'rw-btn-row';
  btns.append(
    button('Reset View [R]', () => rig.resetView(), 'primary'),
    button('Save Default View', () => rig.saveDefaultView()),
  );
  root.appendChild(btns);

  // Reset Up — orbit mode is quaternion-based (TrackballControls), so the
  // world can roll. This button restores +Y up without changing position.
  const upBtns = document.createElement('div');
  upBtns.className = 'rw-btn-row';
  const resetUpBtn = button('Reset Up', () => rig.resetUp());
  resetUpBtn.title = 'Snap up-vector back to +Y. Use this if the world ends up rolled at an awkward angle after orbiting.';
  upBtns.append(resetUpBtn);
  root.appendChild(upBtns);

  // Hard Reset — destructive: clears saved default and snaps to factory
  // defaults. Stylistically warned (`danger` variant) and confirms only
  // when there's a custom saved view to lose.
  const hardBtns = document.createElement('div');
  hardBtns.className = 'rw-btn-row';
  const hardResetBtn = button('Hard Reset Camera [Shift+R]', () => {
    if (rig.hasCustomSavedView()) {
      const ok = confirm(
        'Hard Reset will clear your saved default camera view and return ' +
        'the camera to factory defaults. Continue?',
      );
      if (!ok) return;
    }
    rig.hardReset();
  }, 'danger');
  hardResetBtn.title = 'Resets camera to factory defaults and clears your saved view.';
  hardBtns.append(hardResetBtn);
  root.appendChild(hardBtns);

  const help = document.createElement('div');
  help.className = 'rw-hint';
  help.style.padding = '6px 0';
  help.innerHTML = [
    '<b>Orbit:</b> drag = rotate · right-drag = pan · scroll = zoom · rotation is unconstrained (over the top, behind, fully inverted)',
    '<b>Fly:</b> click canvas to lock pointer · WASD move · QE roll · Space/Ctrl up/down · Shift boost · Esc release',
    '<b>R</b> = reset to saved view · <b>Shift+R</b> = hard reset to factory defaults',
  ].join('<br>');
  root.appendChild(help);

  // ── Anaglyph ────────────────────────────────────────────────────────
  // Renders in red-cyan anaglyph so the user can view (and record/stream)
  // the 3D scene with standard anaglyph glasses. Post-processing (bloom,
  // CRT, feedback) is bypassed while active — the same trade-off as XR.
  // Recording and WHIP streaming automatically capture the anaglyph output
  // since they read from the same canvas.
  const ag = group('Anaglyph 3D');

  const agNote = document.createElement('p');
  agNote.className = 'section-note';
  agNote.textContent =
    'View in red-cyan anaglyph. Requires red-cyan glasses. '
    + 'Post-processing (bloom, CRT, feedback) is paused while active. '
    + 'Recording and streaming automatically capture the anaglyph output.';

  ag.body.append(
    agNote,
    row('Enable', toggle(settings, 'anaglyphEnabled')),
    row('Eye Sep (cm)', slider(settings, 'anaglyphIpdCm', 1.0, 15.0, 0.1)),
  );
  root.appendChild(ag.root);

  // Live readout of camera position/target
  const ro = readout();
  ro.style.marginTop = '6px';
  root.appendChild(ro);
  function tick() {
    const c = rig.camera.position;
    ro.textContent =
      `pos  ${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}\n` +
      `fov  ${rig.camera.fov.toFixed(1)}°  near ${rig.camera.near}  far ${rig.camera.far}`;
    requestAnimationFrame(tick);
  }
  tick();

  return root;
}

// ---------------------------------------------------------------------------
// Resolution group — self-contained so it doesn't clutter createCameraSection
// ---------------------------------------------------------------------------

function buildResolutionGroup(settings: SettingsStore): HTMLElement {
  const grp = group('Resolution');
  const isCompact = () => document.body.dataset.layout === 'compact';

  // ========== Build ALL DOM elements first ==========
  // (subscribe() fires its callback immediately, so every element that
  //  refresh() touches must already exist before subscribe() is called.)

  // ---- Resolution dropdown ----
  const resSel = document.createElement('select');
  resSel.className = 'rw-select';

  function rebuildResOptions(): void {
    const compact = isCompact();
    const current = settings.get('renderResolutionId');
    resSel.innerHTML = '';
    for (const p of RESOLUTION_PRESETS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.desktopOnly && compact
        ? `${p.label} (desktop only)`
        : p.label;
      o.title = p.description;
      if (p.desktopOnly && compact) o.disabled = true;
      resSel.appendChild(o);
    }
    resSel.value = current;
  }
  rebuildResOptions();

  // ---- Fit dropdown (hidden when 'match') ----
  const fitSel = document.createElement('select');
  fitSel.className = 'rw-select';
  for (const [val, lbl] of [
    ['letterbox', 'Letterbox'],
    ['fill',      'Fill (crop)'],
    ['stretch',   'Stretch'],
  ] as [string, string][]) {
    const o = document.createElement('option');
    o.value = val; o.textContent = lbl;
    fitSel.appendChild(o);
  }
  fitSel.value = settings.get('renderFitMode');
  const fitRow = row('Fit', fitSel, 'how to display when aspect differs from window');

  // ---- Warning element (GPU max exceeded) ----
  const warnEl = document.createElement('div');
  warnEl.className = 'rw-hint';
  warnEl.style.color = 'var(--re-warn, #ffaa00)';
  warnEl.style.display = 'none';

  // ---- Custom size inputs ----
  const customWrap = document.createElement('div');
  customWrap.className = 'rw-btn-row';
  customWrap.style.gap = '4px';
  customWrap.style.flexWrap = 'wrap';

  function numInput(settingKey: 'renderResolutionCustomW' | 'renderResolutionCustomH', placeholder: string): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '256'; inp.max = '7680'; inp.step = '2';
    inp.className = 'rw-text';
    inp.placeholder = placeholder;
    inp.style.width = '80px';
    inp.value = String(settings.get(settingKey));
    inp.addEventListener('change', () => {
      const gl = document.querySelector('canvas')?.getContext('webgl2') as WebGL2RenderingContext | null;
      const maxSize = gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number : 7680;
      const v = Math.max(256, Math.min(maxSize, Math.round(+inp.value) || 256));
      if (+inp.value > maxSize) {
        warnEl.textContent = `⚠ Exceeds GPU max (${maxSize}px) — clamped.`;
        warnEl.style.display = 'block';
        setTimeout(() => { warnEl.style.display = 'none'; }, 5000);
      }
      inp.value = String(v);
      settings.set(settingKey, v);
    });
    settings.subscribe(settingKey, (v) => { inp.value = String(v); });
    return inp;
  }

  const wLabel = document.createElement('span');
  wLabel.textContent = 'W'; wLabel.style.color = 'var(--re-text-dim)';
  const hLabel = document.createElement('span');
  hLabel.textContent = 'H'; hLabel.style.color = 'var(--re-text-dim)';
  const wInp = numInput('renderResolutionCustomW', '1920');
  const hInp = numInput('renderResolutionCustomH', '1080');
  customWrap.append(wLabel, wInp, hLabel, hInp);

  // ---- 4K performance note ----
  const perfNote = document.createElement('div');
  perfNote.className = 'rw-hint';
  perfNote.style.color = 'var(--re-warn, #ffaa00)';
  perfNote.style.display = 'none';
  perfNote.textContent = '4K rendering is GPU-intensive. If framerate drops, try Render Scale 0.75 or lower.';

  // ---- Live dimension readout ----
  const dimReadout = readout();
  dimReadout.style.marginTop = '2px';

  // ========== Logic helpers ==========

  function updateDimReadout(): void {
    const id = settings.get('renderResolutionId');
    if (id === 'match') {
      const vp = document.getElementById('stage');
      const w = vp?.clientWidth ?? window.innerWidth;
      const h = vp?.clientHeight ?? window.innerHeight;
      const g = gcd(w, h);
      dimReadout.textContent = `${w}×${h} · ${w / g}:${h / g}`;
      return;
    }
    if (id === 'custom') {
      const cw = settings.get('renderResolutionCustomW');
      const ch = settings.get('renderResolutionCustomH');
      const g = gcd(cw, ch);
      dimReadout.textContent = `${cw}×${ch} · ${cw / g}:${ch / g}`;
      return;
    }
    const preset = RESOLUTION_PRESETS.find((p) => p.id === id);
    if (preset && preset.width > 0) {
      const g = gcd(preset.width, preset.height);
      dimReadout.textContent = `${preset.width}×${preset.height} · ${preset.width / g}:${preset.height / g}`;
    }
  }

  function refresh(): void {
    const id = settings.get('renderResolutionId');
    const matchMode = id === 'match';
    const customMode = id === 'custom';
    const highRes = id === 'uhd' || id === 'dci4k';

    fitRow.style.display     = matchMode ? 'none' : '';
    customWrap.style.display = customMode ? '' : 'none';

    if (highRes) {
      perfNote.style.display = 'block';
      setTimeout(() => { perfNote.style.display = 'none'; }, 5000);
    } else {
      perfNote.style.display = 'none';
    }

    updateDimReadout();
  }

  // ========== Wire up event handlers + subscribes ==========
  // All DOM elements above are fully constructed before any subscribe fires.

  resSel.addEventListener('change', () => {
    settings.set('renderResolutionId', resSel.value);
    refresh();
  });
  // subscribe fires immediately — refresh() is safe to call now
  settings.subscribe('renderResolutionId', (v) => { resSel.value = v; refresh(); });

  fitSel.addEventListener('change', () => settings.set('renderFitMode', fitSel.value as 'letterbox' | 'fill' | 'stretch'));
  settings.subscribe('renderFitMode', (v) => { fitSel.value = v; });

  // ---- Poll readout in match-window mode (updates on window resize) ----
  let prevW = 0, prevH = 0;
  function pollMatchSize() {
    if (settings.get('renderResolutionId') === 'match') {
      const stage = document.getElementById('stage');
      const w = stage?.clientWidth ?? 0;
      const h = stage?.clientHeight ?? 0;
      if (w !== prevW || h !== prevH) { prevW = w; prevH = h; updateDimReadout(); }
    }
    requestAnimationFrame(pollMatchSize);
  }
  pollMatchSize();

  // ---- Rebuild options on layout mode change (compact ↔ standard) ----
  const layoutObs = new MutationObserver(() => rebuildResOptions());
  layoutObs.observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });

  grp.body.append(
    row('Resolution', resSel),
    fitRow,
    customWrap,
    warnEl,
    perfNote,
    dimReadout,
  );

  return grp.root;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
