/**
 * Anaglyph (red-cyan) on-canvas stereo renderer.
 *
 * Wraps the vendored `AnaglyphEffectIpd` (see that file for why the
 * upstream three.js AnaglyphEffect couldn't be used: its eye separation
 * was not settable, which made the Eye Sep slider a no-op — AUDIT.md
 * item 28). Renders the scene twice — once per eye — with Dubois-matrix
 * red-cyan channel splitting composited onto the main canvas. Because the
 * result lands on the existing `renderer.domElement`, canvas capture,
 * MediaRecorder, and WHIP streaming all pick up the anaglyph image
 * automatically with no extra plumbing.
 *
 * The EffectComposer / bloom / postfx pipeline is bypassed while anaglyph
 * is active — same constraint as XR (v11). Postfx return when the toggle
 * is turned off.
 *
 * Eye separation is set via `setIpd(cm)`. The cm value maps to world
 * units through the shared `worldIpdFromCm` convention (mesh bounding-box
 * width as the scale reference) — the SAME mapping StereoCompositor uses
 * for side-by-side recording, so anaglyph depth and recorded stereo depth
 * match for a given IPD setting.
 *
 * Lifecycle:
 *   1. `await AnaglyphRenderer.create(renderer, meshGroup, w, h)` — call
 *      once, then reuse.
 *   2. `setSize(w, h)` whenever the canvas drawing buffer changes.
 *   3. `setIpd(cm)` whenever the IPD setting changes (recomputes the
 *      mesh bounding box — cheap at slider cadence, not per-frame).
 *   4. `render(scene, camera)` each frame instead of `composer.render()`.
 *   5. `dispose()` on teardown (releases internal render targets).
 */

import * as THREE from 'three';
import { AnaglyphEffectIpd } from './AnaglyphEffectIpd';
import { worldIpdFromCm } from './stereoIpd';

export class AnaglyphRenderer {
  private constructor(
    private readonly effect: AnaglyphEffectIpd,
    private readonly meshGroup: THREE.Object3D,
  ) {}

  /**
   * Construct the wrapper.
   * @param renderer   The existing WebGLRenderer.
   * @param meshGroup  The scanline mesh group — its bounding-box width is
   *                   the IPD scale reference (shared stereo convention).
   * @param width      Logical canvas width in CSS pixels.
   * @param height     Logical canvas height in CSS pixels.
   */
  static async create(
    renderer: THREE.WebGLRenderer,
    meshGroup: THREE.Object3D,
    width: number,
    height: number,
  ): Promise<AnaglyphRenderer> {
    const effect = new AnaglyphEffectIpd(renderer, width, height);
    return new AnaglyphRenderer(effect, meshGroup);
  }

  /**
   * Call whenever the drawing-buffer size changes (window resize /
   * resolution-preset change). Resizes the internal render targets;
   * never touches canvas CSS (ResolutionManager owns that).
   */
  setSize(width: number, height: number): void {
    this.effect.setSize(width, height);
  }

  /**
   * Set the inter-pupillary distance in centimetres. Mapped to world
   * units via the shared mesh-width convention (`worldIpdFromCm`).
   */
  setIpd(cm: number): void {
    const box = new THREE.Box3().setFromObject(this.meshGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    this.effect.eyeSep = worldIpdFromCm(cm, size.x);
  }

  /** Render the scene with anaglyph compositing to the main canvas. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.effect.render(scene, camera);
  }

  /** Release internal render targets and shader materials. */
  dispose(): void {
    this.effect.dispose();
  }
}
