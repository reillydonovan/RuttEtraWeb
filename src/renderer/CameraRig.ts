/**
 * Dual-mode 3D camera controller.
 *
 *  - Orbit mode: standard `OrbitControls` — drag rotates around target,
 *    right-drag pans, scroll zooms.
 *  - Fly mode: pointer-locked free flight with WASD + mouse-look so users
 *    can dive *through* the scan-line geometry. Q/E roll, Shift boost,
 *    Space/Ctrl up/down, Esc release.
 *
 * Reset View / Save Default View hooks let users define their own home
 * position; the default is persisted into Settings so it survives reloads
 * and travels with presets.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CameraView, CameraMode, SettingsStore } from '../state/Settings';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private flyControls: PointerLockControls;

  private mode: CameraMode = 'orbit';
  private keys = new Set<string>();
  private autoOrbitAngle = 0;
  private rollVel = 0;

  private reusableEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private reusableQuat = new THREE.Quaternion();
  private moveDir = new THREE.Vector3();

  constructor(private settings: SettingsStore, private domElement: HTMLElement) {
    const s = settings.all;

    this.camera = new THREE.PerspectiveCamera(s.cameraFov, 1, s.cameraNear, s.cameraFar);
    this.applyView(s.defaultView);

    this.orbit = new OrbitControls(this.camera, domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 0.05;
    this.orbit.maxDistance = 50;
    this.orbit.target.set(s.defaultView.targetX, s.defaultView.targetY, s.defaultView.targetZ);
    this.orbit.update();

    this.flyControls = new PointerLockControls(this.camera, domElement);
    this.flyControls.enabled = false;

    this.bindKeyboard();
    this.bindSettings();
  }

  /**
   * Apply a saved view to the live camera (used when a preset whose
   * `defaultView` differs from the current view is loaded).
   */
  applySavedView(view: CameraView): void {
    this.applyView(view);
    this.orbit.target.set(view.targetX, view.targetY, view.targetZ);
    this.orbit.update();
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'orbit') {
      if (this.flyControls.isLocked) this.flyControls.unlock();
      this.flyControls.enabled = false;
      this.orbit.enabled = true;
      // Re-anchor orbit target in front of the camera so the transition feels natural
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      this.orbit.target.copy(this.camera.position).addScaledVector(fwd, 1.5);
      this.orbit.update();
    } else {
      this.orbit.enabled = false;
      this.flyControls.enabled = true;
      // Pointer lock requires a user gesture to engage; we'll arm it on next click
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
  }

  /** Restore the saved default view. */
  resetView(): void {
    const v = this.settings.get('defaultView');
    this.applyView(v);
    this.orbit.target.set(v.targetX, v.targetY, v.targetZ);
    this.orbit.update();
    this.rollVel = 0;
    this.camera.up.set(v.upX, v.upY, v.upZ);
  }

  /** Capture the current camera as the new default and persist it. */
  saveDefaultView(): void {
    const v: CameraView = {
      posX: this.camera.position.x, posY: this.camera.position.y, posZ: this.camera.position.z,
      targetX: this.orbit.target.x, targetY: this.orbit.target.y, targetZ: this.orbit.target.z,
      upX: this.camera.up.x, upY: this.camera.up.y, upZ: this.camera.up.z,
      fov: this.camera.fov,
    };
    this.settings.set('defaultView', v);
  }

  /** Step the controls. Call every frame with deltaTime in seconds. */
  tick(dtSec: number): void {
    if (this.mode === 'orbit') {
      if (this.settings.get('autoOrbit')) {
        const speed = this.settings.get('autoOrbitSpeed');
        this.autoOrbitAngle += speed * dtSec;
        const radius = this.camera.position.distanceTo(this.orbit.target);
        const tgt = this.orbit.target;
        const y = this.camera.position.y;
        this.camera.position.set(
          tgt.x + Math.cos(this.autoOrbitAngle) * radius,
          y,
          tgt.z + Math.sin(this.autoOrbitAngle) * radius,
        );
        this.camera.lookAt(tgt);
      }
      this.orbit.update();
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

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      // Don't capture keys while typing in inputs
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.key === 'r' || e.key === 'R') {
        this.resetView();
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
    s.subscribe('cameraFov',  (fov) => {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    });
    s.subscribe('cameraNear', (n) => {
      this.camera.near = n;
      this.camera.updateProjectionMatrix();
    });
    s.subscribe('cameraFar', (f) => {
      this.camera.far = f;
      this.camera.updateProjectionMatrix();
    });
  }

  private updateFly(dt: number): void {
    const speed = this.settings.get('flySpeed');
    const boost = this.settings.get('flyBoost');
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

    // Roll with Q/E — apply around camera forward axis
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
