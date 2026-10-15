/**
 * Dual-mode 3D camera controller.
 *
 *  - Orbit mode: `TrackballControls` — drag rotates around target,
 *    right-drag pans, scroll zooms. Quaternion-based rotation, so the
 *    camera can rotate freely over the top, behind, or fully inverted
 *    without hitting a polar singularity. Trade-off: the world can
 *    roll, so we expose a `resetUp()` helper to snap +Y back.
 *  - Fly mode: pointer-locked free flight with WASD + mouse-look so users
 *    can dive *through* the scan-line geometry. Q/E roll, Shift boost,
 *    Space/Ctrl up/down, Esc release. Pitch is unclamped.
 *
 * Reset View / Save Default View hooks let users define their own home
 * position; the default is persisted into Settings so it survives reloads
 * and travels with presets.
 *
 * Hard Reset (Shift+R) wipes the saved default view, returns the camera
 * to `FACTORY_CAMERA_DEFAULTS`, releases pointer lock, kills auto-orbit,
 * and switches back to Orbit mode. This is the "I broke the camera, get
 * me back to a known good state" escape hatch.
 */

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CameraView, CameraMode, SettingsStore } from '../state/Settings';
import { LiveValuesStore } from '../modulation/LiveValues';

/**
 * The original built-in starting position before any user customization.
 * Hardcoded — never read from localStorage. `hardReset()` snaps every
 * camera value back to these and clears the saved default view.
 */
export const FACTORY_CAMERA_DEFAULTS = Object.freeze({
  posX: 0,    posY: 0.4,  posZ: 2.6,
  targetX: 0, targetY: 0, targetZ: 0,
  upX: 0,     upY: 1,     upZ: 0,
  fov: 50,
  near: 0.01,
  far: 100,
});

/** Build the `CameraView`-shaped portion of the factory defaults. */
function factoryView(): CameraView {
  const f = FACTORY_CAMERA_DEFAULTS;
  return {
    posX: f.posX, posY: f.posY, posZ: f.posZ,
    targetX: f.targetX, targetY: f.targetY, targetZ: f.targetZ,
    upX: f.upX, upY: f.upY, upZ: f.upZ,
    fov: f.fov,
  };
}

/** True if `v` matches the factory defaults (used to omit from preset export). */
export function isFactoryView(v: CameraView | undefined | null): boolean {
  if (!v) return false;
  const f = FACTORY_CAMERA_DEFAULTS;
  return (
    v.posX === f.posX && v.posY === f.posY && v.posZ === f.posZ &&
    v.targetX === f.targetX && v.targetY === f.targetY && v.targetZ === f.targetZ &&
    v.upX === f.upX && v.upY === f.upY && v.upZ === f.upZ &&
    v.fov === f.fov
  );
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private trackball: TrackballControls;
  private flyControls: PointerLockControls;

  private mode: CameraMode = 'orbit';
  private keys = new Set<string>();
  private rollVel = 0;

  private reusableQuat = new THREE.Quaternion();
  private moveDir = new THREE.Vector3();

  constructor(private settings: SettingsStore, private domElement: HTMLElement, private live: LiveValuesStore) {
    const s = settings.all;

    this.camera = new THREE.PerspectiveCamera(s.cameraFov, 1, s.cameraNear, s.cameraFar);

    // TrackballControls: quaternion rotation, no pole singularity.
    // Picked over OrbitControls so the camera can orbit completely over
    // the top of the raster, behind, or fully inverted without flipping.
    //
    // Important: TrackballControls' constructor calls its own update() at
    // the end which re-runs lookAt(target) using its default target=(0,0,0)
    // and the camera's current orientation. To avoid having the constructor
    // mutate our intended startup view in unexpected ways, we set the target
    // FIRST, then construct, then `applyView` to re-establish our position
    // and lookAt. The constructor's internal update is then harmless because
    // we overwrite its result.
    this.trackball = new TrackballControls(this.camera, domElement);
    this.trackball.rotateSpeed = 3.0;
    this.trackball.zoomSpeed = 1.2;
    this.trackball.panSpeed = 0.8;
    this.trackball.staticMoving = false;
    this.trackball.dynamicDampingFactor = 0.15;
    this.trackball.minDistance = 0.05;
    this.trackball.maxDistance = 50;
    // Disable trackball's keyboard rotate (A/S/D) — those keys belong to fly mode.
    this.trackball.keys = ['', '', ''];
    this.trackball.target.set(s.defaultView.targetX, s.defaultView.targetY, s.defaultView.targetZ);
    this.trackball.handleResize();
    // Apply the saved view AFTER trackball construction to override whatever
    // its initial update() left behind. Camera ends up at the saved position,
    // up-vector, and looking at the saved target.
    this.applyView(s.defaultView);

    this.flyControls = new PointerLockControls(this.camera, domElement);
    this.flyControls.enabled = false;
    // Remove the ±90° pitch clamp so the user can be fully inverted.
    // YXZ Euler still has gimbal lock at exactly ±π/2, but the user can
    // pull through; we add explicit roll on top via Q/E.
    this.flyControls.minPolarAngle = -Infinity;
    this.flyControls.maxPolarAngle = Infinity;

    this.bindKeyboard();
    this.bindSettings();
    this.bindTouch();
  }

  /**
   * Apply a saved view to the live camera (used when a preset whose
   * `defaultView` differs from the current view is loaded).
   */
  applySavedView(view: CameraView): void {
    this.applyView(view);
    this.trackball.target.set(view.targetX, view.targetY, view.targetZ);
    this.trackball.update();
  }

  /**
   * Snapshot the current camera position / target / orientation / fov
   * into a `CameraView`. Used by `XRManager` to stash the pre-XR camera
   * so it can be restored when the headset session ends — keeps the
   * desktop view exactly where it was before the user put the headset on.
   */
  currentView(): CameraView {
    const tgt = this.trackball.target;
    return {
      posX: this.camera.position.x, posY: this.camera.position.y, posZ: this.camera.position.z,
      targetX: tgt.x, targetY: tgt.y, targetZ: tgt.z,
      upX: this.camera.up.x, upY: this.camera.up.y, upZ: this.camera.up.z,
      fov: this.camera.fov,
    };
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'orbit') {
      if (this.flyControls.isLocked) this.flyControls.unlock();
      this.flyControls.enabled = false;
      this.trackball.enabled = true;
      // Re-anchor orbit target in front of the camera so the transition feels natural.
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      this.trackball.target.copy(this.camera.position).addScaledVector(fwd, 1.5);
      this.trackball.update();
    } else {
      this.trackball.enabled = false;
      this.flyControls.enabled = true;
      // Pointer lock requires a user gesture to engage; arm it on next click.
      const onClick = () => {
        if (this.mode === 'fly' && !this.flyControls.isLocked) {
          this.flyControls.lock();
        }
      };
      this.domElement.addEventListener('click', onClick, { once: true });
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // TrackballControls caches the canvas rect for screen-space gesture math.
    this.trackball.handleResize();
  }

  /** Restore the saved default view. */
  resetView(): void {
    const v = this.settings.get('defaultView');
    this.applyView(v);
    this.trackball.target.set(v.targetX, v.targetY, v.targetZ);
    this.trackball.update();
    this.rollVel = 0;
    this.camera.up.set(v.upX, v.upY, v.upZ);
  }

  /**
   * Snap the camera up-vector back to +Y without changing position
   * or target. Used to undo trackball roll when the world ends up at
   * an awkward angle.
   */
  resetUp(): void {
    this.camera.up.set(0, 1, 0);
    // Force trackball to recompute its internal eye vector so the next
    // drag lines up with the new up direction.
    this.trackball.update();
  }

  /** Capture the current camera as the new default and persist it. */
  saveDefaultView(): void {
    const v: CameraView = {
      posX: this.camera.position.x, posY: this.camera.position.y, posZ: this.camera.position.z,
      targetX: this.trackball.target.x, targetY: this.trackball.target.y, targetZ: this.trackball.target.z,
      upX: this.camera.up.x, upY: this.camera.up.y, upZ: this.camera.up.z,
      fov: this.camera.fov,
    };
    this.settings.set('defaultView', v);
  }

  /** True iff the saved default view is anything other than factory defaults. */
  hasCustomSavedView(): boolean {
    return !isFactoryView(this.settings.get('defaultView'));
  }

  /**
   * "I broke the camera, get me back to a known good state."
   *
   * Releases pointer lock, cancels any in-flight motion (auto-orbit,
   * roll), wipes the saved default view, switches back to Orbit if in
   * Fly, and snaps every camera value to {@link FACTORY_CAMERA_DEFAULTS}.
   * After this runs, an exported preset will contain only the factory
   * default view (so it doesn't carry a bespoke saved view to other
   * users).
   */
  hardReset(): void {
    if (this.flyControls.isLocked) this.flyControls.unlock();

    // Cancel transient camera motion.
    this.rollVel = 0;
    this.keys.clear();

    if (this.settings.get('autoOrbit')) {
      this.settings.set('autoOrbit', false);
    }

    // Switch back to Orbit if currently flying — settings subscriber re-runs setMode.
    if (this.mode === 'fly' || this.settings.get('cameraMode') === 'fly') {
      this.settings.set('cameraMode', 'orbit');
    }

    const f = FACTORY_CAMERA_DEFAULTS;

    // Wipe persisted state in one go: defaultView + lens settings.
    // The `defaultView` subscriber re-applies the view, but it short-circuits
    // when `JSON.stringify(v) === lastDefault` — so we also call applyView
    // directly below to handle the "saved view already equals factory" case.
    this.settings.batchUpdate({
      defaultView: factoryView(),
      cameraFov: f.fov,
      cameraNear: f.near,
      cameraFar: f.far,
    });

    this.applyView(factoryView());
    this.trackball.target.set(f.targetX, f.targetY, f.targetZ);
    this.trackball.update();

    this.trackball.enabled = true;
  }

  /** Step the controls. Call every frame with deltaTime in seconds. */
  tick(dtSec: number): void {
    if (this.mode === 'orbit') {
      if (this.settings.get('autoOrbit')) {
        const speed = this.live.getLive('autoOrbitSpeed');
        const tgt = this.trackball.target;
        const pos = this.camera.position;
        // Orbit in the horizontal plane, starting from wherever the camera
        // is now. (Using the full 3D distance as the horizontal radius while
        // keeping the height grew the orbit every frame whenever the camera
        // sat above or below the target, so it spiralled away; starting from
        // a stored angle made the view jump when auto-orbit was enabled.)
        const radius = Math.hypot(pos.x - tgt.x, pos.z - tgt.z);
        const angle = Math.atan2(pos.z - tgt.z, pos.x - tgt.x) + speed * dtSec;
        pos.set(tgt.x + Math.cos(angle) * radius, pos.y, tgt.z + Math.sin(angle) * radius);
        this.camera.lookAt(tgt);
      }
      this.trackball.update();
    } else {
      this.updateFly(dtSec);
    }
  }

  // -------------------- internals --------------------

  private applyView(v: CameraView): void {
    this.camera.position.set(v.posX, v.posY, v.posZ);
    this.camera.up.set(v.upX, v.upY, v.upZ);
    this.camera.fov = v.fov;
    this.camera.lookAt(v.targetX, v.targetY, v.targetZ);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Touch-only gestures on the canvas:
   *   - double-tap (within 320ms) → resetView()
   *   - long-press (600ms hold) → "peek" mode: dispatches `re-peek-start`
   *     / `re-peek-end` events on document (host toggles UI hidden class)
   */
  private bindTouch(): void {
    const el = this.domElement;
    let lastTapAt = 0;
    let pressTimer: number | null = null;
    let peeking = false;
    let downX = 0, downY = 0;

    const startPeek = () => {
      if (peeking) return;
      peeking = true;
      document.dispatchEvent(new CustomEvent('re-peek-start'));
    };
    const endPeek = () => {
      if (!peeking) return;
      peeking = false;
      document.dispatchEvent(new CustomEvent('re-peek-end'));
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      downX = e.clientX; downY = e.clientY;
      const now = performance.now();
      if (now - lastTapAt < 320) {
        this.resetView();
        lastTapAt = 0;
      } else {
        lastTapAt = now;
      }
      if (pressTimer != null) clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        startPeek();
      }, 600);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8 && pressTimer != null) {
        clearTimeout(pressTimer); pressTimer = null;
      }
    });
    const cancel = () => {
      if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; }
      endPeek();
    };
    el.addEventListener('pointerup',     cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave',  cancel);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Don't capture keys while typing in inputs
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.key === 'r' || e.key === 'R') {
        if (e.shiftKey) {
          // Shift+R: full factory reset. No confirmation here — the
          // CameraSection button shows a confirm dialog when there's a
          // custom saved view, but the keyboard shortcut is opt-in
          // (you typed it intentionally) and should always be instant.
          this.hardReset();
        } else {
          this.resetView();
        }
        return;
      }
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  private bindSettings(): void {
    const s = this.settings;
    s.subscribe('cameraMode', (mode) => this.setMode(mode));
    // cameraFov is modulatable — read live so LFOs etc. can wobble it
    // without overwriting the user's base FOV in Settings.
    this.live.subscribe('cameraFov',  (fov) => {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    });
    this.live.subscribe('cameraNear', (n) => {
      this.camera.near = n;
      this.camera.updateProjectionMatrix();
    });
    this.live.subscribe('cameraFar', (f) => {
      this.camera.far = f;
      this.camera.updateProjectionMatrix();
    });
  }

  private updateFly(dt: number): void {
    const speed = this.live.getLive('flySpeed');
    const boost = this.live.getLive('flyBoost');
    const k = this.keys;

    let f = 0, r = 0, u = 0;
    if (k.has('w')) f += 1;
    if (k.has('s')) f -= 1;
    if (k.has('d')) r += 1;
    if (k.has('a')) r -= 1;
    if (k.has(' ')) u += 1;
    if (k.has('control')) u -= 1;

    const mult = (k.has('shift') ? boost : 1) * speed * dt;

    if (f !== 0 || r !== 0 || u !== 0) {
      const fwd = this.moveDir;
      this.camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
      this.camera.position
        .addScaledVector(fwd, f * mult)
        .addScaledVector(right, r * mult)
        .addScaledVector(this.camera.up, u * mult);
    }

    // Roll with Q/E around the camera-forward axis. No clamp — full 360°.
    let rollInput = 0;
    if (k.has('q')) rollInput -= 1;
    if (k.has('e')) rollInput += 1;
    this.rollVel = THREE.MathUtils.lerp(this.rollVel, rollInput * 1.5, Math.min(1, dt * 8));
    if (Math.abs(this.rollVel) > 1e-4) {
      const fwd = this.moveDir;
      this.camera.getWorldDirection(fwd);
      this.reusableQuat.setFromAxisAngle(fwd, this.rollVel * dt);
      this.camera.up.applyQuaternion(this.reusableQuat).normalize();
    }
  }
}
