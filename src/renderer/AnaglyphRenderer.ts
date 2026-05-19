/**
 * Thin wrapper around Three.js's `AnaglyphEffect`.
 *
 * Renders the scene twice — once per eye — with Dubois-matrix red-cyan
 * channel splitting composited onto the main canvas. Because the result
 * lands on the existing `renderer.domElement`, canvas capture, MediaRecorder,
 * and WHIP streaming all pick up the anaglyph image automatically with no
 * extra plumbing.
 *
 * The EffectComposer / bloom / postfx pipeline is bypassed while anaglyph
 * is active — same constraint as XR (v11). Postfx return when the toggle
 * is turned off.
 *
 * Eye separation is set via `setIpd(cm)`. The value maps to Three.js's
 * `AnaglyphEffect.eyeSep` (stored internally in metres).
 *
 * Resize note: `AnaglyphEffect.setSize()` calls `renderer.setSize()` with
 * `updateStyle = true`, which would overwrite inline canvas CSS and break the
 * ResolutionManager fill-layout. This wrapper clears those inline styles after
 * each `setSize` call so ResolutionManager remains the sole owner of canvas
 * CSS dimensions.
 *
 * Lifecycle:
 *   1. `await AnaglyphRenderer.create(renderer, w, h)` — lazy-imports the
 *      Three.js effect. Call once, then reuse.
 *   2. `setSize(w, h)` whenever the canvas drawing buffer changes.
 *   3. `setIpd(cm)` whenever the IPD setting changes.
 *   4. `render(scene, camera)` each frame instead of `composer.render()`.
 *   5. `dispose()` on teardown (releases internal render targets).
 */

import type * as THREE from 'three';

/** Minimal type surface of `AnaglyphEffect` we actually use. */
interface AnaglyphEffectInstance {
  /** Eye separation in metres. Direct property (not on a sub-object). */
  eyeSep: number;
  /** Distance to the zero-parallax screen plane in world units. */
  planeDistance: number;
  setSize(width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export class AnaglyphRenderer {
  private constructor(
    private readonly effect: AnaglyphEffectInstance,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  /**
   * Lazy-import `AnaglyphEffect` and construct the wrapper.
   * @param renderer  The existing WebGLRenderer.
   * @param width     Logical canvas width in CSS pixels.
   * @param height    Logical canvas height in CSS pixels.
   */
  static async create(
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ): Promise<AnaglyphRenderer> {
    const mod = await import('three/examples/jsm/effects/AnaglyphEffect.js');
    // Cast via unknown: @types/three's AnaglyphEffect decl doesn't expose
    // eyeSep / planeDistance, but the runtime object has them (see source).
    const effect = new mod.AnaglyphEffect(renderer, width, height) as unknown as AnaglyphEffectInstance;
    const wrapper = new AnaglyphRenderer(effect, renderer.domElement as HTMLCanvasElement);
    // Undo any inline CSS that the constructor may have set so ResolutionManager
    // remains the sole owner of canvas sizing.
    wrapper.clearCanvasStyle();
    return wrapper;
  }

  /**
   * Call whenever the drawing-buffer size changes (window resize /
   * resolution-preset change). Resizes the internal render targets to
   * match, then strips the inline `width` / `height` styles that
   * `AnaglyphEffect.setSize()` injects onto the canvas element.
   */
  setSize(width: number, height: number): void {
    this.effect.setSize(width, height);
    this.clearCanvasStyle();
  }

  /**
   * Set the inter-pupillary distance in centimetres.
   * `AnaglyphEffect.eyeSep` is stored in metres.
   */
  setIpd(cm: number): void {
    this.effect.eyeSep = Math.max(0.1, cm) / 100;
  }

  /** Render the scene with anaglyph compositing to the main canvas. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.effect.render(scene, camera);
  }

  /** Release internal render targets and shader materials. */
  dispose(): void {
    this.effect.dispose();
  }

  /** Strip inline canvas CSS so the CSS layout rules take precedence. */
  private clearCanvasStyle(): void {
    this.canvas.style.width  = '';
    this.canvas.style.height = '';
  }
}
