/**
 * Vendored port of three.js's `examples/jsm/effects/AnaglyphEffect.js`
 * (r169) with one behavioral fix: **eye separation is actually settable.**
 *
 * Upstream code: Copyright © 2010-2024 three.js authors. Released under the
 * MIT License (https://github.com/mrdoob/three.js/blob/dev/LICENSE); this
 * notice is kept as that license requires.
 *
 * The upstream effect creates its `StereoCamera` as a `const` inside the
 * constructor closure and never reads any instance property for eye
 * separation — assigning `effect.eyeSep = x` on the upstream class sets a
 * dead property and the stereo pair silently stays at the StereoCamera
 * default (0.064 world units). That was the "IPD slider does nothing" bug
 * (AUDIT.md item 28).
 *
 * This port exposes `eyeSep` (world units) as a real public field, copied
 * into the internal `StereoCamera` on every `render()` — StereoCamera's
 * own projection cache makes the copy free when unchanged.
 *
 * Second deliberate difference: `setSize()` calls
 * `renderer.setSize(w, h, /* updateStyle *\/ false)` so the effect never
 * injects inline CSS onto the canvas — ResolutionManager is the sole
 * owner of canvas CSS sizing (see PRINCIPLES.md #1).
 *
 * Dubois matrices and compositing shader are verbatim from upstream.
 */

import {
  LinearFilter,
  Matrix3,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  StereoCamera,
  WebGLRenderTarget,
} from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export class AnaglyphEffectIpd {
  /** Eye separation in world units. Applied on the next `render()`. */
  eyeSep = 0.064;

  readonly colorMatrixLeft: Matrix3;
  readonly colorMatrixRight: Matrix3;

  private readonly renderer: WebGLRenderer;
  private readonly stereo = new StereoCamera();
  private readonly renderTargetL: WebGLRenderTarget;
  private readonly renderTargetR: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(renderer: WebGLRenderer, width = 512, height = 512) {
    this.renderer = renderer;

    // Dubois matrices from
    // https://citeseerx.ist.psu.edu/viewdoc/download?doi=10.1.1.7.6968&rep=rep1&type=pdf#page=4
    this.colorMatrixLeft = new Matrix3().fromArray([
      0.456100, -0.0400822, -0.0152161,
      0.500484, -0.0378246, -0.0205971,
      0.176381, -0.0157589, -0.00546856,
    ]);
    this.colorMatrixRight = new Matrix3().fromArray([
      -0.0434706, 0.378476, -0.0721527,
      -0.0879388, 0.73364, -0.112961,
      -0.00155529, -0.0184503, 1.2264,
    ]);

    const params = { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat };
    this.renderTargetL = new WebGLRenderTarget(width, height, params);
    this.renderTargetR = new WebGLRenderTarget(width, height, params);

    this.material = new ShaderMaterial({
      uniforms: {
        mapLeft: { value: this.renderTargetL.texture },
        mapRight: { value: this.renderTargetR.texture },
        colorMatrixLeft: { value: this.colorMatrixLeft },
        colorMatrixRight: { value: this.colorMatrixRight },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '	vUv = vec2( uv.x, uv.y );',
        '	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D mapLeft;',
        'uniform sampler2D mapRight;',
        'varying vec2 vUv;',
        'uniform mat3 colorMatrixLeft;',
        'uniform mat3 colorMatrixRight;',
        'void main() {',
        '	vec2 uv = vUv;',
        '	vec4 colorL = texture2D( mapLeft, uv );',
        '	vec4 colorR = texture2D( mapRight, uv );',
        '	vec3 color = clamp(',
        '			colorMatrixLeft * colorL.rgb +',
        '			colorMatrixRight * colorR.rgb, 0., 1. );',
        '	gl_FragColor = vec4(',
        '			color.r, color.g, color.b,',
        '			max( colorL.a, colorR.a ) );',
        '	#include <tonemapping_fragment>',
        '	#include <colorspace_fragment>',
        '}',
      ].join('\n'),
    });

    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number): void {
    // updateStyle = false: never touch the canvas's inline CSS.
    this.renderer.setSize(width, height, false);
    const pixelRatio = this.renderer.getPixelRatio();
    this.renderTargetL.setSize(width * pixelRatio, height * pixelRatio);
    this.renderTargetR.setSize(width * pixelRatio, height * pixelRatio);
  }

  render(scene: Scene, camera: Camera): void {
    const renderer = this.renderer;
    const currentRenderTarget = renderer.getRenderTarget();

    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

    // The fix: the public field drives the internal StereoCamera.
    this.stereo.eyeSep = this.eyeSep;
    this.stereo.update(camera as Parameters<StereoCamera['update']>[0]);

    renderer.setRenderTarget(this.renderTargetL);
    renderer.clear();
    renderer.render(scene, this.stereo.cameraL);

    renderer.setRenderTarget(this.renderTargetR);
    renderer.clear();
    renderer.render(scene, this.stereo.cameraR);

    renderer.setRenderTarget(null);
    this.quad.render(renderer);

    renderer.setRenderTarget(currentRenderTarget);
  }

  dispose(): void {
    this.renderTargetL.dispose();
    this.renderTargetR.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
