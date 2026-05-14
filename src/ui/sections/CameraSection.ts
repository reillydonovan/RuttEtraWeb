/**
 * Camera section — orbit/fly mode toggle, FOV/near/far, auto-orbit,
 * Reset View, Save Default View, and a numeric readout of the current
 * camera transform.
 */

import { SettingsStore } from '../../state/Settings';
import { CameraRig } from '../../renderer/CameraRig';
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
