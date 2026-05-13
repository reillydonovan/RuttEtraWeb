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
import { SettingsStore } from '../state/Settings';

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
  varying vec2 vUv;

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

    gl_FragColor = col;
  }
`;

const FEEDBACK_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;   // current scene
  uniform sampler2D tPrev;      // previous accumulator
  uniform float uDecay;         // 0..1 (higher = longer trails)
  varying vec2 vUv;
  void main() {
    vec3 cur = texture2D(tDiffuse, vUv).rgb;
    vec3 old = texture2D(tPrev, vUv).rgb * uDecay;
    gl_FragColor = vec4(max(cur, old), 1.0);
  }
`;

const COPY_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`;

export class PostFX {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private crt: ShaderPass;
  private feedbackPass: ShaderPass;
  private copyMaterial: THREE.ShaderMaterial;
  private feedbackRT: THREE.WebGLRenderTarget;
  private fsQuad: THREE.Mesh;
  private fsScene: THREE.Scene;
  private fsCamera: THREE.OrthographicCamera;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
    private settings: SettingsStore,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.feedbackRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this.feedbackPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        tPrev:    { value: this.feedbackRT.texture },
        uDecay:   { value: settings.get('feedbackDecay') },
      },
      vertexShader: VERT,
      fragmentShader: FEEDBACK_FRAG,
    });
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
      },
      vertexShader: VERT,
      fragmentShader: CRT_FRAG,
    });
    this.composer.addPass(this.crt);

    this.composer.addPass(new OutputPass());

    // Persistent fullscreen-quad rig used to copy the feedback pass's output
    // back into the feedbackRT once per frame.
    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
    });
    this.fsScene = new THREE.Scene();
    this.fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMaterial);
    this.fsScene.add(this.fsQuad);

    this.bindSettings();
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    (this.crt.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    this.feedbackRT.setSize(width, height);
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  render(dt: number): void {
    this.composer.render(dt);

    // After the frame is composited, snapshot the feedback pass's *input*
    // (i.e. the current scene render) into our persistent feedback RT for
    // use next frame. EffectComposer's read/write buffers ping-pong each
    // pass; the feedback pass's tDiffuse uniform holds whatever was the
    // read buffer at that point — we copy that texture into feedbackRT.
    if (this.feedbackPass.enabled) {
      const tex = this.feedbackPass.uniforms.tDiffuse.value as THREE.Texture | null;
      if (tex) {
        this.copyMaterial.uniforms.tDiffuse.value = tex;
        const oldRT = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.feedbackRT);
        this.renderer.render(this.fsScene, this.fsCamera);
        this.renderer.setRenderTarget(oldRT);
      }
    }
  }

  private bindSettings(): void {
    const s = this.settings;

    s.subscribe('bloomEnabled',   (v) => { this.bloom.enabled = v; });
    s.subscribe('bloomIntensity', (v) => { this.bloom.strength = v; });
    s.subscribe('bloomRadius',    (v) => { this.bloom.radius = v; });
    s.subscribe('bloomThreshold', (v) => { this.bloom.threshold = v; });

    s.subscribe('scanlineEnabled',   (v) => { this.crt.uniforms.uScanlineOn.value = v ? 1 : 0; });
    s.subscribe('scanlineIntensity', (v) => { this.crt.uniforms.uScanlineIntensity.value = v; });
    s.subscribe('scanlineDensity',   (v) => { this.crt.uniforms.uScanlineDensity.value = v; });

    s.subscribe('chromaEnabled', (v) => { this.crt.uniforms.uChromaOn.value = v ? 1 : 0; });
    s.subscribe('chromaAmount',  (v) => { this.crt.uniforms.uChromaAmount.value = v; });

    s.subscribe('vignetteEnabled', (v) => { this.crt.uniforms.uVignetteOn.value = v ? 1 : 0; });
    s.subscribe('vignetteAmount',  (v) => { this.crt.uniforms.uVignetteAmount.value = v; });

    s.subscribe('feedbackEnabled', (v) => { this.feedbackPass.enabled = v; });
    s.subscribe('feedbackDecay',   (v) => { this.feedbackPass.uniforms.uDecay.value = v; });
  }
}
