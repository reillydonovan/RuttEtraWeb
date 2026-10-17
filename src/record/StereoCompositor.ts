/**
 * Side-by-side stereoscopic compositor for desktop stereo recording (v12).
 *
 * The synth's normal render path produces a monoscopic frame on the
 * visible canvas via `EffectComposer`. Stereoscopic recording adds a
 * parallel path: an offscreen canvas with its own `THREE.WebGLRenderer`
 * that renders the same scene twice per frame — once through a
 * left-eye camera, once through a right-eye camera — and writes the
 * result side-by-side. `MediaRecorder` captures the offscreen canvas
 * via `captureStream()`.
 *
 * Architecture decisions:
 *
 *   - SECOND `WebGLRenderer`, not render-target-then-blit. Three.js's
 *     `WebGLRenderer` is bound to one canvas at construction. The
 *     options are (a) render to RTs + readPixels + 2D blit (CPU
 *     roundtrip every frame, kills perf), (b) tiny composite renderer
 *     on the offscreen canvas sampling two RTs (extra plumbing for
 *     no real win), or (c) a second full renderer on the offscreen
 *     canvas that re-renders the scene. Option (c) is what every
 *     three.js stereo demo does; geometry / material / texture
 *     buffers are shared across renderers, so the GPU memory cost is
 *     a few MB of renderer state, not duplicate scene memory.
 *
 *   - NO POSTFX in stereo output. Same Option A as XR. The synth's
 *     `EffectComposer` chain (RenderPass → Feedback → UnrealBloom →
 *     CRT → Output) doesn't compose with per-eye stereo rendering
 *     without significant work, so v1 ships raw mesh. Documented in
 *     the Help / About pages.
 *
 *   - ROLL-RESISTANT HORIZONTAL OFFSET. The IPD axis is derived by
 *     crossing the camera's forward vector with world-up, not by
 *     reading `camera.right`. If the user has rolled the camera
 *     through `TrackballControls`, `camera.right` tilts with the
 *     roll and stereo separation goes vertical. The cross-product
 *     keeps the IPD axis aligned to world-horizontal regardless of
 *     roll. Degenerate when looking straight up/down (forward ≈
 *     world-up); in that case we fall back to `camera.right` because
 *     stereo is meaningless when looking along the axis of stereo
 *     anyway, and the user gets monoscopic-ish output rather than
 *     a NaN crash.
 *
 *   - IPD SCALING. The user sees centimeters because that's what an
 *     IPD value means in real life. The compositor converts to world
 *     units using the mesh's bounding-box X extent as a reference
 *     (the synth's natural mesh is roughly meter-scale, so 6.3cm
 *     produces a comfortable default at default scan rate). Recomputed
 *     on every `start` / `setIpd` so mesh resize between recordings
 *     stays honest.
 *
 *   - PREVIEW MODE. `renderPreviewTo(renderer)` runs the same stereo
 *     render but targets a user-supplied renderer (in practice, the
 *     main visible renderer) so the user can SEE the side-by-side
 *     composite for a few seconds before committing to record. The
 *     compositor doesn't own the preview's lifecycle — it just
 *     exposes the render primitive; `RecordSection` owns the 3-second
 *     timer and the swap-in/swap-out around the main render loop.
 */

import * as THREE from 'three';
import { SettingsStore } from '../state/Settings';
import { LiveValuesStore } from '../modulation/LiveValues';
import { worldIpdFromCm } from '../renderer/stereoIpd';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface StereoCompositorDeps {
  scene: THREE.Scene;
  sourceCamera: THREE.PerspectiveCamera;
  meshGroup: THREE.Object3D;
  settings: SettingsStore;
  live: LiveValuesStore;
}

export class StereoCompositor {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private sourceCamera: THREE.PerspectiveCamera;
  private meshGroup: THREE.Object3D;
  private settings: SettingsStore;
  private live: LiveValuesStore;
  private leftCamera = new THREE.PerspectiveCamera();
  private rightCamera = new THREE.PerspectiveCamera();
  private eyeWidth = 0;
  private eyeHeight = 0;
  private active = false;
  private worldIpd = 0;
  // Cached scratch vectors so per-frame `tick` allocates nothing.
  private scratchForward = new THREE.Vector3();
  private scratchRight = new THREE.Vector3();
  // Reusable Vector4s for snapshotting the caller renderer's
  // viewport/scissor state before our two-eye draws. Allocating
  // these once keeps the preview path GC-quiet.
  private scratchPrevViewport = new THREE.Vector4();
  private scratchPrevScissor  = new THREE.Vector4();

  constructor(deps: StereoCompositorDeps) {
    this.scene = deps.scene;
    this.sourceCamera = deps.sourceCamera;
    this.meshGroup = deps.meshGroup;
    this.settings = deps.settings;
    this.live = deps.live;

    // Offscreen canvas — not attached to the DOM. captureStream()
    // works on detached canvases just fine; the visible canvas is
    // the main render's responsibility.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1; this.canvas.height = 1;

    // preserveDrawingBuffer is required for `captureStream()` to
    // reliably observe rendered frames across browsers — without it,
    // the framebuffer can be cleared at composite-commit time before
    // MediaRecorder samples it.
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  /**
   * Begin a stereo recording session. Sets the per-eye render
   * dimensions (composite canvas is twice as wide), recomputes the
   * world-unit IPD, marks the compositor active so `tick()` will
   * render. Must be paired with `stop()` when recording ends.
   */
  start(eyeWidth: number, eyeHeight: number): void {
    this.eyeWidth = Math.max(1, Math.round(eyeWidth));
    this.eyeHeight = Math.max(1, Math.round(eyeHeight));
    this.canvas.width = this.eyeWidth * 2;
    this.canvas.height = this.eyeHeight;
    this.renderer.setSize(this.eyeWidth * 2, this.eyeHeight, false);
    this.worldIpd = this.computeWorldIpd();
    this.active = true;
  }

  /** Stop the recording-time render. Renderer + canvas stay allocated
   *  so subsequent `start()` calls don't pay context-creation cost. */
  stop(): void {
    this.active = false;
  }

  isActive(): boolean { return this.active; }
  outputWidth(): number  { return this.eyeWidth * 2; }
  outputHeight(): number { return this.eyeHeight; }

  /** Recompute world-unit IPD from the current Settings + mesh size.
   *  Called automatically on `start()`; surfaced separately so the
   *  RecordSection IPD slider can re-tune the running session. */
  refreshIpd(): void {
    this.worldIpd = this.computeWorldIpd();
  }

  /**
   * MediaStream for the side-by-side canvas. Suitable for direct
   * consumption by `MediaRecorder` — pass the requested `fps` and
   * the browser pulls frames at that cadence (skipping if the
   * compositor renders slower).
   */
  getStream(fps: number): MediaStream {
    type Captureable = HTMLCanvasElement & { captureStream(fps?: number): MediaStream };
    return (this.canvas as Captureable).captureStream(fps);
  }

  /** The side-by-side canvas — read directly by the WebCodecs recording engine. */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Per-frame draw into the offscreen canvas. No-op when inactive. */
  tick(): void {
    if (!this.active) return;
    this.renderStereo(this.renderer, this.eyeWidth, this.eyeHeight);
  }

  /**
   * Run one stereo render into an externally-owned renderer. Used
   * by the 3-second preview to write the side-by-side composite
   * directly to the main visible canvas. Caller is responsible for
   * the renderer's lifecycle and for restoring viewport / scissor
   * state expected by its own subsequent renders.
   */
  renderPreviewTo(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    const eyeW = Math.max(1, Math.floor(width / 2));
    const eyeH = Math.max(1, height);
    // Use the live setting so dragging the slider during preview
    // updates the visible composite immediately.
    this.worldIpd = this.computeWorldIpd();
    // Source camera aspect matches the eye half, not the full
    // composite — both views need to look "natural" inside their
    // half, not stretched.
    this.renderStereo(renderer, eyeW, eyeH);
  }

  /** Releases the WebGL context. Call when the compositor is gone
   *  for good (i.e. on tab teardown); cheap enough to never need
   *  in practice since the compositor lives for the page lifetime. */
  dispose(): void {
    this.renderer.dispose();
  }

  // ---------------- internals ----------------

  /**
   * Mesh-aware world-unit IPD. Uses the mesh's bounding box X extent
   * as a reference — when the mesh happens to be ~1 unit wide, the
   * IPD matches centimeters-to-units 1:1; a 10-unit-wide mesh scales
   * the offset up proportionally so stereo looks the same on screen
   * regardless of mesh scale.
   *
   * The bounding box is recomputed each call (it's an O(verts) walk
   * but only fires on `start()` / `refreshIpd()` / preview, not per
   * frame). Falls back to a plain cm-to-units if the bbox is degenerate.
   */
  private computeWorldIpd(): number {
    const ipdCm = this.live.getLive('stereoIpdCm');
    const box = new THREE.Box3().setFromObject(this.meshGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Shared cm→world convention with the anaglyph renderer — see
    // src/renderer/stereoIpd.ts (one concept, one source).
    return worldIpdFromCm(ipdCm, size.x);
  }

  private updateEyeCameras(eyeW: number, eyeH: number): void {
    const cam = this.sourceCamera;
    const halfIpd = this.worldIpd / 2;

    // Roll-resistant horizontal axis: cross(forward, world-up).
    cam.getWorldDirection(this.scratchForward);
    this.scratchRight.crossVectors(this.scratchForward, WORLD_UP);
    if (this.scratchRight.lengthSq() < 1e-6) {
      // Looking straight up or down — fall back to the camera's own
      // right axis. Stereo on the axis of stereo is undefined anyway.
      cam.matrixWorld.extractBasis(
        this.scratchRight,
        new THREE.Vector3(),
        new THREE.Vector3(),
      );
    }
    this.scratchRight.normalize();

    this.leftCamera.position.copy(cam.position).addScaledVector(this.scratchRight, -halfIpd);
    this.rightCamera.position.copy(cam.position).addScaledVector(this.scratchRight,  halfIpd);

    this.leftCamera.quaternion.copy(cam.quaternion);
    this.rightCamera.quaternion.copy(cam.quaternion);

    for (const eye of [this.leftCamera, this.rightCamera]) {
      eye.fov    = cam.fov;
      eye.near   = cam.near;
      eye.far    = cam.far;
      eye.aspect = eyeW / eyeH;
      eye.updateProjectionMatrix();
    }
  }

  private renderStereo(renderer: THREE.WebGLRenderer, eyeW: number, eyeH: number): void {
    this.updateEyeCameras(eyeW, eyeH);

    // Save the FULL viewport/scissor state we're about to mutate so
    // caller-owned renderers resume cleanly. Restoring just the
    // scissor-test boolean is not enough: after the second eye's
    // draw, the viewport rect is `(eyeW, 0, eyeW, eyeH)`. If the
    // caller's next render (postfx, EffectComposer's OutputPass,
    // etc.) doesn't explicitly reset the viewport, it inherits our
    // right-half rect and the visible canvas ends up cropped to a
    // quarter-screen. This bug only surfaces in the preview path
    // because the offscreen recording renderer is never read again
    // for monoscopic drawing; here we play it safe regardless.
    const prevScissorTest = renderer.getScissorTest();
    renderer.getViewport(this.scratchPrevViewport);
    renderer.getScissor(this.scratchPrevScissor);

    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, eyeW, eyeH);
    renderer.setScissor (0, 0, eyeW, eyeH);
    renderer.render(this.scene, this.leftCamera);
    renderer.setViewport(eyeW, 0, eyeW, eyeH);
    renderer.setScissor (eyeW, 0, eyeW, eyeH);
    renderer.render(this.scene, this.rightCamera);

    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(this.scratchPrevViewport);
    renderer.setScissor(this.scratchPrevScissor);
  }
}
