/**
 * Post-processing pipeline: bloom + a combined CRT pass that handles
 * scanline overlay, chromatic aberration, vignette. Optional feedback
 * accumulation runs as a fullscreen "max(current, previous * decay)"
 * blend before the bloom stage.
 *
 * Pipeline:
 *   RenderPass (scene)
 *   -> [optional Feedback blend in place]
 *   -> UnrealBloomPass (phosphor glow)
 *   -> CRT Pass (scanlines, chroma, vignette)
 *   -> OutputPass (tonemap + color space)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SettingsStore } from '../state/Settings';
import { LiveValuesStore } from '../modulation/LiveValues';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CRT_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2  uResolution;
  uniform float uScanlineIntensity;
  uniform float uScanlineDensity;
  uniform float uChromaAmount;
  uniform float uVignetteAmount;
  uniform float uScanlineOn;
  uniform float uChromaOn;
  uniform float uVignetteOn;
  // v24: analog character (AUDIT items 20 + 22) — grain, dropout
  // lines, rolling hum bar. The Izotope-Vinyl-style wear layer, video
  // flavored.
  uniform float uAnalogOn;
  uniform float uNoiseAmt;
  uniform float uDropoutAmt;
  uniform float uHumAmt;
  uniform float uTimeSec;
  varying vec2 vUv;

  float hash12(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 col;

    if (uChromaOn > 0.5) {
      vec2 dir = uv - 0.5;
      float r = texture2D(tDiffuse, uv + dir * uChromaAmount).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * uChromaAmount).b;
      col = vec4(r, g, b, 1.0);
    } else {
      col = texture2D(tDiffuse, uv);
    }

    if (uScanlineOn > 0.5) {
      float s = sin(uv.y * uScanlineDensity * 3.14159);
      float scan = mix(1.0, 0.5 + 0.5 * s, uScanlineIntensity);
      col.rgb *= scan;
    }

    if (uVignetteOn > 0.5) {
      vec2 d = (uv - 0.5);
      float v = 1.0 - dot(d, d) * 2.0 * uVignetteAmount;
      col.rgb *= clamp(v, 0.0, 1.0);
    }

    // v24: analog character — grain, dropout lines, rolling hum bar.
    if (uAnalogOn > 0.5) {
      // Per-pixel, per-frame video grain.
      float g = hash12(uv * uResolution + fract(uTimeSec) * 61.7) - 0.5;
      col.rgb += g * uNoiseAmt * 0.35;
      // Sparse horizontal dropout lines: occasional rows tear bright
      // or dark for one refresh, like tape wear.
      float rowKey = hash12(vec2(floor(uv.y * 270.0), floor(uTimeSec * 24.0)));
      if (rowKey > 1.0 - uDropoutAmt * 0.05) {
        float polarity = step(0.5, hash12(vec2(rowKey, 7.0)));
        col.rgb = mix(col.rgb, vec3(polarity), 0.6);
      }
      // Slow-rolling hum bar (mains interference on an old monitor).
      float hum = sin((uv.y + uTimeSec * 0.11) * 6.28318);
      col.rgb *= 1.0 - uHumAmt * 0.25 * (0.5 + 0.5 * hum);
    }

    gl_FragColor = col;
  }
`;

const FEEDBACK_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;   // current scene
  uniform sampler2D tPrev;      // previous accumulator
  uniform float uDecay;         // 0..1 (higher = longer trails)
  // v24: shape-masked feedback (AUDIT item 19). Mode 0 = full frame
  // (classic), 1 = circle, 2 = box. Trails only accumulate inside the
  // shape; center/radius/softness are modulatable, so the region can
  // be moved around the frame live.
  uniform float uShapeMode;
  uniform vec2  uShapeCenter;   // 0..1 UV space
  uniform float uShapeRadius;   // 0..1
  uniform float uShapeSoft;     // feather width
  varying vec2 vUv;
  void main() {
    vec3 cur = texture2D(tDiffuse, vUv).rgb;
    float mask = 1.0;
    if (uShapeMode > 0.5) {
      vec2 d = vUv - uShapeCenter;
      float dist = (uShapeMode > 1.5) ? max(abs(d.x), abs(d.y)) : length(d);
      mask = 1.0 - smoothstep(uShapeRadius - uShapeSoft, uShapeRadius, dist);
    }
    vec3 old = texture2D(tPrev, vUv).rgb * uDecay * mask;
    gl_FragColor = vec4(max(cur, old), 1.0);
  }
`;

const COPY_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`;

/**
 * Video-feedback pass with a private ping-pong accumulator.
 *
 * The previous implementation was a plain ShaderPass whose accumulator
 * was snapshotted AFTER `composer.render()` from the pass's `tDiffuse`
 * uniform. That was broken in two compounding ways: EffectComposer
 * ping-pongs two buffers, so by post-render time the buffer that held
 * the feedback input had been overwritten by the CRT pass; and copying
 * the pass *input* (not its output) meant the trail never accumulated —
 * `tPrev` was only ever last frame's scene, a one-frame echo instead of
 * a compounding burn-in. Net effect: the "Burn-In Feedback" toggle was
 * visually near-inert (AUDIT.md item 21).
 *
 * This pass owns the accumulation instead, at the moment it runs:
 *
 *   1. accumNext = max(scene, accumPrev * decay)   → private RT (ping-pong)
 *   2. accumNext copied to the composer's write buffer
 *
 * The on-screen image and the accumulator are the same texture by
 * construction, so trails compound at exactly `decay` per frame:
 * decay 0.9 ≈ 0.1 s half-life, 0.99 ≈ 1.1 s, 0.999 ≈ 11.5 s.
 */
class FeedbackAccumulatorPass extends Pass {
  private readonly feedbackMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private accumA: THREE.WebGLRenderTarget;
  private accumB: THREE.WebGLRenderTarget;
  /** When set, both accumulator targets are cleared before the next
   *  frame — used on enable so a minutes-old ghost never reappears. */
  private clearRequested = true;

  constructor(width: number, height: number, decay: number) {
    super();
    this.needsSwap = true;
    const params: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    };
    this.accumA = new THREE.WebGLRenderTarget(width, height, params);
    this.accumB = new THREE.WebGLRenderTarget(width, height, params);
    this.feedbackMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tPrev:    { value: this.accumA.texture },
        uDecay:   { value: decay },
        uShapeMode:   { value: 0 },
        uShapeCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uShapeRadius: { value: 0.35 },
        uShapeSoft:   { value: 0.1 },
      },
      vertexShader: VERT,
      fragmentShader: FEEDBACK_FRAG,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
    });
    this.quad = new FullScreenQuad(this.feedbackMaterial);
  }

  setDecay(v: number): void {
    this.feedbackMaterial.uniforms.uDecay.value = v;
  }

  /** v24: shape mask controls (0 full / 1 circle / 2 box). */
  setShapeMode(mode: number): void {
    this.feedbackMaterial.uniforms.uShapeMode.value = mode;
  }
  setShapeCenter(x: number, y: number): void {
    (this.feedbackMaterial.uniforms.uShapeCenter.value as THREE.Vector2).set(x, y);
  }
  setShapeRadius(v: number): void {
    this.feedbackMaterial.uniforms.uShapeRadius.value = v;
  }
  setShapeSoftness(v: number): void {
    this.feedbackMaterial.uniforms.uShapeSoft.value = v;
  }

  /** Clear the trail history (applied lazily on the next render). */
  requestClear(): void {
    this.clearRequested = true;
  }

  setSize(width: number, height: number): void {
    this.accumA.setSize(width, height);
    this.accumB.setSize(width, height);
    // Resizing invalidates contents anyway; restart the trail cleanly.
    this.clearRequested = true;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    if (this.clearRequested) {
      this.clearRequested = false;
      const oldColor = new THREE.Color();
      renderer.getClearColor(oldColor);
      const oldAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(this.accumA);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(this.accumB);
      renderer.clear(true, false, false);
      renderer.setClearColor(oldColor, oldAlpha);
    }

    // 1. Accumulate into the spare target: max(scene, prev * decay).
    this.feedbackMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.feedbackMaterial.uniforms.tPrev.value = this.accumA.texture;
    this.quad.material = this.feedbackMaterial;
    renderer.setRenderTarget(this.accumB);
    this.quad.render(renderer);

    // 2. Copy the fresh accumulator to the composer chain.
    this.copyMaterial.uniforms.tDiffuse.value = this.accumB.texture;
    this.quad.material = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);

    // 3. Ping-pong.
    const tmp = this.accumA;
    this.accumA = this.accumB;
    this.accumB = tmp;
  }

  dispose(): void {
    this.accumA.dispose();
    this.accumB.dispose();
    this.feedbackMaterial.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
  }
}

export class PostFX {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private crt: ShaderPass;
  private feedbackPass: FeedbackAccumulatorPass;
  private bloomRTDivisor = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
    private settings: SettingsStore,
    width: number,
    height: number,
    private live: LiveValuesStore,
  ) {
    // Use a half-float HDR render target with 4× MSAA for the composer's
    // internal ping-pong buffers:
    //
    //  • HalfFloatType — preserves HDR values (> 1.0) from the scene so
    //    the bloom and ACES tonemapping in OutputPass operate on the full
    //    luminance range rather than 0-1-clamped 8-bit values.
    //
    //  • samples: 4 — multi-sample anti-aliasing on the RenderPass's target.
    //    `antialias: true` on WebGLRenderer only applies to the canvas's
    //    default framebuffer, which the EffectComposer never writes to
    //    directly. Without samples here, wire geometry renders with hard
    //    1-pixel edges regardless of the renderer's MSAA setting.
    //    WebGL 2 resolves the MSAA buffer automatically before the next pass
    //    samples it as a texture.
    //
    // HalfFloat is always supported in WebGL 2 (all modern browsers). On
    // any platform where it somehow fails, Three.js falls back to unsigned
    // byte automatically.
    const composerRT = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      type:    THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.composer = new EffectComposer(renderer, composerRT);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // The accumulator targets must match the PHYSICAL pixel dimensions of
    // the composer's internal render targets (width × pixelRatio). Using
    // logical pixels would produce a low-res buffer that gets upscaled each
    // frame, turning the feedback into a blurry smear when DPR > 1.
    const physW = Math.floor(width  * renderer.getPixelRatio());
    const physH = Math.floor(height * renderer.getPixelRatio());
    this.feedbackPass = new FeedbackAccumulatorPass(physW, physH, settings.get('feedbackDecay'));
    this.feedbackPass.enabled = settings.get('feedbackEnabled');
    this.composer.addPass(this.feedbackPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      settings.get('bloomIntensity'),
      settings.get('bloomRadius'),
      settings.get('bloomThreshold'),
    );
    this.bloom.enabled = settings.get('bloomEnabled');
    this.composer.addPass(this.bloom);

    this.crt = new ShaderPass({
      uniforms: {
        tDiffuse:           { value: null },
        uResolution:        { value: new THREE.Vector2(width, height) },
        uScanlineIntensity: { value: settings.get('scanlineIntensity') },
        uScanlineDensity:   { value: settings.get('scanlineDensity') },
        uChromaAmount:      { value: settings.get('chromaAmount') },
        uVignetteAmount:    { value: settings.get('vignetteAmount') },
        uScanlineOn:        { value: settings.get('scanlineEnabled') ? 1 : 0 },
        uChromaOn:          { value: settings.get('chromaEnabled') ? 1 : 0 },
        uVignetteOn:        { value: settings.get('vignetteEnabled') ? 1 : 0 },
        uAnalogOn:          { value: settings.get('analogEnabled') ? 1 : 0 },
        uNoiseAmt:          { value: settings.get('analogNoise') },
        uDropoutAmt:        { value: settings.get('analogDropout') },
        uHumAmt:            { value: settings.get('analogHum') },
        uTimeSec:           { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: CRT_FRAG,
    });
    this.composer.addPass(this.crt);

    this.composer.addPass(new OutputPass());

    this.bindSettings();
  }

  resize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    // Bloom resolution is divided by `bloomRTDivisor` set via setBloomRTDivisor.
    this.bloom.resolution.set(width / this.bloomRTDivisor, height / this.bloomRTDivisor);
    (this.crt.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    // The feedback accumulator must stay at physical pixel dimensions —
    // using logical dimensions would make it smaller than the composer's
    // ping-pong buffers on HiDPI displays.
    const physW = Math.floor(width  * this.renderer.getPixelRatio());
    const physH = Math.floor(height * this.renderer.getPixelRatio());
    this.feedbackPass.setSize(physW, physH);
  }

  /** Set bloom render-target divisor (1=full, 2=half, 4=quarter). */
  setBloomRTDivisor(div: number): void {
    if (div < 1) div = 1;
    this.bloomRTDivisor = div;
    // Re-apply current size on next tick — caller usually invokes resize().
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  private timeSec = 0;

  render(dt: number): void {
    // Feedback accumulation happens inside FeedbackAccumulatorPass at its
    // point in the chain — no post-render snapshot needed (the old
    // snapshot approach read a buffer that later passes had already
    // overwritten; see the pass's docblock).
    this.timeSec += Number.isFinite(dt) ? Math.max(0, Math.min(0.5, dt)) : 1 / 60;
    this.crt.uniforms.uTimeSec.value = this.timeSec;
    this.composer.render(dt);
  }

  private bindSettings(): void {
    const s = this.settings;
    const live = this.live;

    // Modulatable: bloomIntensity, bloomRadius, scanlineIntensity,
    // chromaAmount, feedbackDecay. Toggles + non-modulatable params
    // stay on `settings.subscribe`.
    s.subscribe('bloomEnabled',   (v) => { this.bloom.enabled = v; });
    live.subscribe('bloomIntensity', (v) => { this.bloom.strength = v; });
    live.subscribe('bloomRadius',    (v) => { this.bloom.radius = v; });
    s.subscribe('bloomThreshold', (v) => { this.bloom.threshold = v; });

    s.subscribe('scanlineEnabled',   (v) => { this.crt.uniforms.uScanlineOn.value = v ? 1 : 0; });
    live.subscribe('scanlineIntensity', (v) => { this.crt.uniforms.uScanlineIntensity.value = v; });
    s.subscribe('scanlineDensity',   (v) => { this.crt.uniforms.uScanlineDensity.value = v; });

    s.subscribe('chromaEnabled', (v) => { this.crt.uniforms.uChromaOn.value = v ? 1 : 0; });
    live.subscribe('chromaAmount',  (v) => { this.crt.uniforms.uChromaAmount.value = v; });

    s.subscribe('vignetteEnabled', (v) => { this.crt.uniforms.uVignetteOn.value = v ? 1 : 0; });
    s.subscribe('vignetteAmount',  (v) => { this.crt.uniforms.uVignetteAmount.value = v; });

    s.subscribe('feedbackEnabled', (v) => {
      this.feedbackPass.enabled = v;
      // Fresh trail on every enable — never resurrect a stale ghost.
      if (v) this.feedbackPass.requestClear();
    });
    live.subscribe('feedbackDecay',   (v) => { this.feedbackPass.setDecay(v); });

    // v24: shape-masked feedback. Center/radius/softness are
    // modulatable so the region can orbit the frame from an LFO.
    s.subscribe('feedbackShape', (shape) => {
      this.feedbackPass.setShapeMode(shape === 'circle' ? 1 : shape === 'box' ? 2 : 0);
    });
    live.subscribe('feedbackShapeX', (x) => {
      this.feedbackPass.setShapeCenter(x, this.live.getLive('feedbackShapeY'));
    });
    live.subscribe('feedbackShapeY', (y) => {
      this.feedbackPass.setShapeCenter(this.live.getLive('feedbackShapeX'), y);
    });
    live.subscribe('feedbackShapeRadius',   (v) => { this.feedbackPass.setShapeRadius(v); });
    live.subscribe('feedbackShapeSoftness', (v) => { this.feedbackPass.setShapeSoftness(v); });

    // v24: analog character.
    s.subscribe('analogEnabled', (v) => { this.crt.uniforms.uAnalogOn.value = v ? 1 : 0; });
    live.subscribe('analogNoise',   (v) => { this.crt.uniforms.uNoiseAmt.value = v; });
    live.subscribe('analogDropout', (v) => { this.crt.uniforms.uDropoutAmt.value = v; });
    live.subscribe('analogHum',     (v) => { this.crt.uniforms.uHumAmt.value = v; });
  }
}
