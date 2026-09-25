/**
 * WebXR session lifecycle manager (v11 / WebXR v1).
 *
 * Owns the immersive-vr / immersive-ar session, the headset-aware
 * three.js renderer configuration, and the stash-and-restore plumbing
 * for the desktop state that XR temporarily takes over:
 *
 *   - The scene's `Settings.backgroundColor` is overridden to black
 *     in VR (matches the original Rutt/Etra phosphor-on-void aesthetic
 *     and avoids headset glare) and to null in AR (so passthrough
 *     composites underneath the mesh). Restored on session end.
 *   - The `RuttEtraScene.root` group is scaled and translated to the
 *     `xrMeshScale` preset's bounding volume, anchored to the user's
 *     local-floor reference space at a comfortable viewing height.
 *     Restored on session end.
 *   - The desktop `CameraRig` view is snapshotted on session start
 *     and applied back on session end so the user returns to exactly
 *     where they were before putting the headset on.
 *   - The desktop performance profile is stashed by `PerformanceProfileManager.beginXrSession`
 *     and restored — or kept-with-toast if the user changed it
 *     mid-XR — by `endXrSession`.
 *
 * What this manager DELIBERATELY does NOT do (v1 scope):
 *
 *   - Controller / hand input. The body's API surface is start / end.
 *   - In-headset UI. The desktop UI keeps running and editing the
 *     synth instance the headset is rendering; user reaches over.
 *   - Per-eye postfx. The render loop in `main.ts` branches to
 *     `renderer.render(scene, camera)` when `isPresenting`, skipping
 *     the EffectComposer (which can't render to the XR framebuffer).
 *
 * Session state — the active mode `'immersive-vr' | 'immersive-ar' |
 * null` — lives on this manager via `sessionMode`, NOT in `Settings`.
 * Putting it in Settings would serialize runtime state into projects
 * and require a structural force-null carve-out in `migrateSettings()`;
 * keeping it here matches the data model to the state's actual
 * lifetime (Principle 7).
 */

import * as THREE from 'three';
import { CameraView, SettingsStore, XrMeshScale } from '../state/Settings';
import { CameraRig } from './CameraRig';
import { setOutputActive } from './rasterIdentify';
import {
  PerformanceProfileManager,
  resolveXrProfile,
  XrEndResult,
  XrProfileSnapshot,
} from '../perf/PerformanceProfile';

export type XrSessionMode = 'immersive-vr' | 'immersive-ar';

/**
 * Per-preset mesh framing in meters (local-floor reference space).
 *
 *   - `scale` is the multiplier applied uniformly to `RuttEtraScene.root`.
 *     Picked so the mesh's natural ±1 unit extent maps to the target
 *     bounding volume listed in the principles. Tuned by feel; the
 *     user can re-pick mid-session if they want a different framing.
 *   - `positionZ` is negative (forward in three.js); `positionY` is
 *     the height above the user's actual floor where the mesh center
 *     sits. Tabletop default puts the mesh at chest height (≈1.2m),
 *     ahead by 1m — comfortable for seated or standing use.
 *   - Tabletop centers slightly closer; roomscale steps it back; the
 *     architectural preset is far enough that the user is dwarfed by
 *     the mesh, with the documented caveat that v1 has no teleport.
 */
interface MeshFraming {
  scale: number;
  positionY: number;
  positionZ: number;
}

const FRAMING: Record<XrMeshScale, MeshFraming> = {
  tabletop:     { scale: 0.6, positionY: 1.2, positionZ: -1.0 },
  roomscale:    { scale: 1.5, positionY: 1.0, positionZ: -2.0 },
  architectural:{ scale: 5.0, positionY: 1.0, positionZ: -5.0 },
};

/**
 * Pre-XR stash. Captured on session start, replayed on session end.
 * Holds only the bits of desktop state that the XR session takes over.
 */
interface PreSessionStash {
  cameraView: CameraView;
  sceneBackground: THREE.Color | THREE.Texture | null;
  meshScale: THREE.Vector3;
  meshPosition: THREE.Vector3;
}

/**
 * Public layout-mode handle. `XRManager` needs to know the active
 * layout mode at session-end time so `PerformanceProfileManager`
 * can re-apply the right per-mode profile. Passed in as a getter
 * rather than as a stored field so the manager always sees the
 * current value (e.g. if the user resized the window during XR).
 */
export type LayoutModeGetter = () => 'compact' | 'standard' | 'expansive';

export interface XRManagerDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  meshGroup: THREE.Object3D;
  cameraRig: CameraRig;
  settings: SettingsStore;
  perfMgr: PerformanceProfileManager;
  getLayoutMode: LayoutModeGetter;
}

/**
 * Optional toast hook — main.ts passes the existing project-toast
 * function so XR notifications use the same UI surface. Wrapped in
 * an interface so the manager has zero direct dependency on the
 * project UI module.
 */
export interface XRToastHook {
  show(message: string): void;
}

export type SessionLifecycleListener = () => void;

export interface XRSupport {
  vr: boolean;
  ar: boolean;
}

export class XRManager {
  private deps: XRManagerDeps;
  private toast: XRToastHook | null;
  private mode: XrSessionMode | null = null;
  private stash: PreSessionStash | null = null;
  private session: XRSession | null = null;
  private startListeners = new Set<SessionLifecycleListener>();
  private endListeners = new Set<SessionLifecycleListener>();
  private boundOnVisibilityChange = () => this.handleVisibilityChange();
  private boundOnSessionEnd = () => this.handleSessionEnd();

  constructor(deps: XRManagerDeps, toast?: XRToastHook) {
    this.deps = deps;
    this.toast = toast ?? null;
    this.deps.renderer.xr.enabled = true;
  }

  get sessionMode(): XrSessionMode | null { return this.mode; }
  get isActive(): boolean { return this.mode !== null; }

  /**
   * Feature-detect WebXR support. Resolves to `false` if `navigator.xr`
   * is absent (Safari, older browsers) or the specific mode is not
   * supported (no AR on most desktop headsets). Safe to call repeatedly
   * — the result reflects current device state, so unplugging a
   * headset between calls flips a `true` to `false`.
   */
  async isSupported(mode: XrSessionMode): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported(mode);
    } catch {
      return false;
    }
  }

  /** Convenience: check both modes in parallel. */
  async getSupport(): Promise<XRSupport> {
    const [vr, ar] = await Promise.all([
      this.isSupported('immersive-vr'),
      this.isSupported('immersive-ar'),
    ]);
    return { vr, ar };
  }

  /**
   * Start an immersive session. Throws if another session is already
   * active — the caller (UI button) is expected to gate this on the
   * inactive state. Errors from `requestSession` propagate; the UI
   * surfaces them as a toast rather than swallowing them per Principle 3.
   */
  async startSession(mode: XrSessionMode): Promise<void> {
    if (this.mode !== null) {
      throw new Error('XR session already active');
    }
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('WebXR not available in this browser');

    // Required features: `local-floor` reference space so the mesh
    // floats at a real height in the user's room rather than at the
    // session origin (which is often eye-level). Optional features
    // are flagged with `optionalFeatures` so a device without them
    // (e.g. Vision Pro with no hand-tracking exposed to WebXR) still
    // grants the session.
    const init: XRSessionInit = mode === 'immersive-ar'
      ? {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hit-test', 'dom-overlay', 'hand-tracking'],
        }
      : {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hand-tracking', 'layers'],
        };

    const session = await xr.requestSession(mode, init);

    // Stash the desktop state we're about to override. Done BEFORE
    // mutating anything so a thrown error mid-setup can roll back
    // cleanly. (Defensive — none of the steps below should throw.)
    this.stash = {
      cameraView: this.deps.cameraRig.currentView(),
      sceneBackground: this.deps.scene.background,
      meshScale: this.deps.meshGroup.scale.clone(),
      meshPosition: this.deps.meshGroup.position.clone(),
    };

    // Tell PerformanceProfileManager the XR session is starting so it
    // can stash the per-mode profile map for restore-or-keep-with-toast
    // semantics on `endSession`.
    this.deps.perfMgr.beginXrSession();

    // Configure renderer XR plumbing. `setReferenceSpaceType` must be
    // called before `setSession` for three.js to use the right space.
    this.deps.renderer.xr.setReferenceSpaceType('local-floor');
    await this.deps.renderer.xr.setSession(session);

    // Apply the XR-side performance knobs (framebuffer scale + foveation).
    // These are the only XR-effective knobs in v1 since postfx is bypassed.
    const xrProfile: XrProfileSnapshot = resolveXrProfile(
      this.deps.settings.get('xrPerformanceProfile'),
    );
    this.applyXrProfileToRenderer(xrProfile);

    // Apply scene-background override and mesh framing.
    this.applyModeBackground(mode);
    this.applyMeshFraming(this.deps.settings.get('xrMeshScale'));

    // Wire session lifecycle and tab-visibility safety.
    this.session = session;
    setOutputActive('xr', true);
    session.addEventListener('end', this.boundOnSessionEnd);
    if (this.deps.settings.get('xrAutoEndOnVisibilityChange')) {
      document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
    }

    this.mode = mode;
    for (const cb of this.startListeners) cb();
  }

  /**
   * End the active session. Idempotent — calling on an inactive manager
   * is a no-op. Cleanup happens in `handleSessionEnd` either way
   * (driven by the XRSession's `end` event, which fires for both
   * explicit `session.end()` and external causes like the user
   * removing the headset).
   */
  async endSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await session.end();
    } catch {
      // `session.end()` can throw if the session is already ending
      // (e.g. user pulled the headset before our promise resolves).
      // The 'end' event still fires; handleSessionEnd will clean up.
    }
  }

  /**
   * Apply a new mesh framing preset. Safe to call mid-session — the
   * mesh re-frames in place. Also safe to call outside a session;
   * stash records the pre-XR mesh transform so end-of-session always
   * restores the original.
   */
  setMeshScale(scale: XrMeshScale): void {
    this.deps.settings.set('xrMeshScale', scale);
    if (this.isActive) this.applyMeshFraming(scale);
  }

  onSessionStart(cb: SessionLifecycleListener): () => void {
    this.startListeners.add(cb);
    return () => this.startListeners.delete(cb);
  }

  onSessionEnd(cb: SessionLifecycleListener): () => void {
    this.endListeners.add(cb);
    return () => this.endListeners.delete(cb);
  }

  // ---------------- internals ----------------

  private applyModeBackground(mode: XrSessionMode): void {
    if (mode === 'immersive-ar') {
      // AR: passthrough composites underneath. A null scene background
      // tells three.js to leave alpha=0 pixels for the camera feed.
      this.deps.scene.background = null;
    } else {
      // VR: force pure black, the canonical phosphor-on-void backdrop
      // and easier on the eyes than the user's chosen desktop bg.
      this.deps.scene.background = new THREE.Color(0x000000);
    }
  }

  private applyMeshFraming(scale: XrMeshScale): void {
    const framing = FRAMING[scale];
    this.deps.meshGroup.scale.setScalar(framing.scale);
    this.deps.meshGroup.position.set(0, framing.positionY, framing.positionZ);
  }

  private applyXrProfileToRenderer(profile: XrProfileSnapshot): void {
    // Both calls are no-ops on devices that don't expose the feature.
    // Three.js tolerates being told to set foveation on a non-Quest
    // session — it just won't observe it.
    this.deps.renderer.xr.setFramebufferScaleFactor(profile.framebufferScale);
    this.deps.renderer.xr.setFoveation(profile.foveation);
  }

  private handleVisibilityChange(): void {
    if (!document.hidden) return;
    if (this.mode === null) return;
    // User minimized, switched tabs, or otherwise hid this tab.
    // Treat as an implicit Exit XR — the renderer is no longer
    // visible anyway, and keeping the session live drains battery.
    void this.endSession();
  }

  private handleSessionEnd(): void {
    setOutputActive('xr', false);
    const stash = this.stash;
    const layoutMode = this.deps.getLayoutMode();

    // Detach listeners first so we don't double-fire on weird teardown.
    document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
    if (this.session) {
      this.session.removeEventListener('end', this.boundOnSessionEnd);
    }

    // Restore mesh transform, scene background, and the desktop camera.
    // Each guarded with optional-chaining so a partially-initialized
    // stash (e.g. an error mid-startSession) doesn't blow up here.
    if (stash) {
      this.deps.meshGroup.scale.copy(stash.meshScale);
      this.deps.meshGroup.position.copy(stash.meshPosition);
      this.deps.scene.background = stash.sceneBackground;
      this.deps.cameraRig.applySavedView(stash.cameraView);
    }

    // Settle performance profile. Toast on kept-user-change so the user
    // knows their mid-XR profile pick was preserved.
    const perfResult: XrEndResult = this.deps.perfMgr.endXrSession(layoutMode);
    if (perfResult.kind === 'kept-user-change' && this.toast) {
      this.toast.show(
        `Desktop profile kept at ${perfResult.newProfileId} (changed during XR session).`,
      );
    }

    this.session = null;
    this.stash = null;
    this.mode = null;
    for (const cb of this.endListeners) cb();
  }
}
