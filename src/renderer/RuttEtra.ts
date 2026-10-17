/**
 * Three.js scene that turns a video element into the Rutt/Etra effect.
 *
 * Holds a `LineSegments` mesh whose vertices are arranged as a regular
 * `cols × rows` grid. The custom vertex shader displaces each vertex on Z
 * by the luminance of the video texture at that vertex's UV.
 *
 * The geometry is rebuilt lazily when scan-rate or column count changes.
 * All other parameters are live shader uniforms — no rebuild needed.
 */

import * as THREE from 'three';
import vertSrc from './shaders/ruttEtra.vert.glsl?raw';
import fragSrc from './shaders/ruttEtra.frag.glsl?raw';
import { SettingsStore, ColorMode } from '../state/Settings';
import { PHOSPHOR_GREEN_HEX, tintHexFor } from '../state/colorModes';
import { LiveValuesStore } from '../modulation/LiveValues';

const COLOR_MODE_INDEX: Record<ColorMode, number> = {
  grayscale: 0,
  phosphorGreen: 1,
  phosphorAmber: 1,
  phosphorCustom: 1,
  video: 2,
};

const PHOSPHOR_GREEN = new THREE.Color(PHOSPHOR_GREEN_HEX);

export class RuttEtraScene {
  readonly scene = new THREE.Scene();
  readonly group = new THREE.Group();
  videoTexture: THREE.VideoTexture | null = null;

  private material!: THREE.ShaderMaterial;
  private mesh: THREE.LineSegments | null = null;
  private currentCols = 0;
  private currentRows = 0;

  private uniforms!: { [key: string]: THREE.IUniform };

  // v23: dual raster (feature-flagged, default off). Raster B is a second
  // LineSegments SHARING raster A's BufferGeometry, with its own material
  // whose uniforms bind to the b* Settings keys. When the flag is off
  // mesh B is invisible and uDualMode stays 0 — the singleton path is
  // untouched.
  private materialB!: THREE.ShaderMaterial;
  private meshB: THREE.LineSegments | null = null;
  private uniformsB!: { [key: string]: THREE.IUniform };

  private spectrumTexture: THREE.DataTexture | null = null;
  private spectrumData: Float32Array = new Float32Array(32);
  private spectrumBandCount = 32;

  constructor(
    private settings: SettingsStore,
    private video: HTMLVideoElement,
    private live: LiveValuesStore,
  ) {
    this.scene.add(this.group);

    const bg = new THREE.Color(this.settings.get('backgroundColor'));
    this.scene.background = bg;

    this.createMaterial();
    this.attachVideo();
    this.rebuildGeometry();
    this.bindSettings();
  }

  /** Returns the underlying Object3D so the camera rig can frame it. */
  get root(): THREE.Object3D {
    return this.group;
  }

  /** Refresh video texture if the source video changes. */
  attachVideo(): void {
    if (this.videoTexture) {
      this.videoTexture.dispose();
      this.videoTexture = null;
    }
    const tex = new THREE.VideoTexture(this.video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format = THREE.RGBAFormat;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    this.videoTexture = tex;
    this.uniforms.uVideo.value = tex;
    this.uniformsB.uVideo.value = tex;
    this.updateTexel();
  }

  /** Update the resolution-of-the-video uniform when metadata loads. */
  updateTexel(): void {
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    (this.uniforms.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.uniformsB.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  /**
   * Bind an arbitrary `THREE.Texture` (e.g. a `WebGLRenderTarget.texture`)
   * as the DCU's video input, and update `uVideoTexel` to match its
   * resolution. Used by the Pattern Generator to feed a synthesized
   * signal through the same vertex displacement pipeline.
   *
   * Call `attachVideo()` again to restore the live `<video>` source.
   */
  setExternalVideoTexture(tex: THREE.Texture, width: number, height: number): void {
    this.uniforms.uVideo.value = tex;
    this.uniformsB.uVideo.value = tex;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    (this.uniforms.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.uniformsB.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  /**
   * Bind a texture as raster B's OWN video input, independent of raster
   * A's (`uniforms.uVideo`, owned by `attachVideo()`/
   * `setExternalVideoTexture()` above — both of those still touch
   * `uniformsB` too, so the pre-existing default of "both rasters
   * mirror one source" is unaffected). Used by the Patch Bay's Dual
   * Raster node so the two rasters can display two DIFFERENT feeds —
   * the one case `docs/design/dual-raster.md` flagged as "explicitly
   * out of v1: per-raster video sources."
   *
   * Call this AFTER `attachVideo()`/`setExternalVideoTexture()` in the
   * same frame if raster A also needs updating that frame — those
   * methods always resync B to A, so this must run last to make B's
   * override stick.
   */
  setExternalVideoTextureB(tex: THREE.Texture, width: number, height: number): void {
    this.uniformsB.uVideo.value = tex;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    (this.uniformsB.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  setSize(_width: number, _height: number): void {
    /* placeholder for future thick-line resolution updates */
  }

  /** Update time-driven uniforms; call every frame. */
  tick(dtSec: number, timeSec: number): void {
    this.uniforms.uTime.value = timeSec;
    const sp = this.settings.all;
    if (sp.hSpinRate !== 0) {
      this.settings.set('hSpin', sp.hSpin + sp.hSpinRate * dtSec);
    }
    if (sp.vSpinRate !== 0) {
      this.settings.set('vSpin', sp.vSpin + sp.vSpinRate * dtSec);
    }
  }

  /**
   * Push the latest FFT band values into the spectrum texture so the vertex
   * shader can sample them. Call once per frame from main loop after
   * `fft.tick()`. The bands array is treated as length-N R-channel data.
   */
  updateSpectrum(bands: Float32Array): void {
    if (bands.length !== this.spectrumBandCount) {
      this.ensureSpectrumTexture(bands.length);
    }
    this.spectrumData.set(bands);
    if (this.spectrumTexture) this.spectrumTexture.needsUpdate = true;
  }

  dispose(): void {
    this.material?.dispose();
    this.materialB?.dispose();
    this.mesh?.geometry.dispose();
    this.videoTexture?.dispose();
    this.spectrumTexture?.dispose();
  }

  private ensureSpectrumTexture(n: number): void {
    const len = Math.max(1, n | 0);
    this.spectrumBandCount = len;
    this.spectrumData = new Float32Array(len);
    this.spectrumTexture?.dispose();
    const tex = new THREE.DataTexture(this.spectrumData as Float32Array<ArrayBuffer>, len, 1, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.spectrumTexture = tex;
    if (this.uniforms) this.uniforms.uSpectrum.value = tex;
    if (this.uniformsB) this.uniformsB.uSpectrum.value = tex;
  }

  // -------------------- internals --------------------

  private createMaterial(): void {
    this.uniforms = this.makeUniformSet(0);
    this.uniformsB = this.makeUniformSet(1);

    this.ensureSpectrumTexture(this.spectrumBandCount);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertSrc,
      fragmentShader: fragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // Raster B material — same shaders, its own uniform set. Constructing
    // the object is cheap; the GPU program only compiles if mesh B ever
    // renders (flag on).
    this.materialB = new THREE.ShaderMaterial({
      uniforms: this.uniformsB,
      vertexShader: vertSrc,
      fragmentShader: fragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  /** Full uniform set for one raster. `side` feeds uDualSide (0 = A, 1 = B). */
  private makeUniformSet(side: 0 | 1): { [key: string]: THREE.IUniform } {
    return {
      uVideo:        { value: null },
      uVideoTexel:   { value: new THREE.Vector2(1 / 640, 1 / 480) },

      uMirror:       { value: new THREE.Vector2(1, 0) },

      uFocus:        { value: 0 },
      uThreshold:    { value: 0.04 },
      uContrast:     { value: 1 },
      uGamma:        { value: 1 },

      uZPush:        { value: 0.9 },
      uZBias:        { value: 0 },
      uZInvert:      { value: 0 },

      uLinearity:    { value: new THREE.Vector2(0, 0) },
      uAspect:       { value: 4 / 3 },
      uSize:         { value: new THREE.Vector2(1, 1) },
      uPos:          { value: new THREE.Vector2(0, 0) },
      uCenter:       { value: new THREE.Vector2(0, 0) },

      uRotate90:     { value: 0 },
      uRotation:     { value: 0 },
      uHSpin:        { value: 0 },
      uVSpin:        { value: 0 },
      uHReverse:     { value: 0 },
      uVReverse:     { value: 0 },

      uSkip:         { value: 0 },
      uRows:         { value: 240 },
      uTime:         { value: 0 },

      uIntensity:    { value: 1 },
      uTint:         { value: PHOSPHOR_GREEN.clone() },
      uColorMode:    { value: 1 },
      uAlphaFalloff: { value: 0.4 },

      uSpectrum:        { value: null },
      uSpectrumAmount:  { value: 0.5 },
      uSpectrumStride:  { value: 1.0 },
      uSpectrumOn:      { value: 0 },

      // v23: dual raster
      uDualMode:     { value: 0 },
      uDualSide:     { value: side },
      uWipe:         { value: 0 },
    };
  }

  /** (Re)build the scan-line geometry with current cols/rows. */
  private rebuildGeometry(): void {
    const cols = Math.max(2, this.settings.get('cols') | 0);
    const rows = Math.max(2, this.settings.get('scanRate') | 0);

    if (cols === this.currentCols && rows === this.currentRows) return;
    this.currentCols = cols;
    this.currentRows = rows;
    this.uniforms.uRows.value = rows;
    this.uniformsB.uRows.value = rows;

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.meshB) {
      // Shares mesh A's geometry (already disposed above) — just detach.
      this.group.remove(this.meshB);
      this.meshB = null;
    }

    const segPerRow = cols - 1;
    const total = rows * segPerRow * 2;
    const positions = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);

    let pi = 0;
    let ui = 0;
    for (let r = 0; r < rows; r++) {
      const v = r / (rows - 1);
      const y = (v - 0.5) * 1.5;
      for (let c = 0; c < segPerRow; c++) {
        const u0 = c / (cols - 1);
        const u1 = (c + 1) / (cols - 1);
        const x0 = (u0 - 0.5) * 2.0;
        const x1 = (u1 - 0.5) * 2.0;
        positions[pi++] = x0; positions[pi++] = y; positions[pi++] = 0;
        positions[pi++] = x1; positions[pi++] = y; positions[pi++] = 0;
        uvs[ui++] = u0; uvs[ui++] = 1 - v;
        uvs[ui++] = u1; uvs[ui++] = 1 - v;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mesh = new THREE.LineSegments(geom, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.mesh = mesh;

    // Raster B: same geometry, material B, only in the scene while the
    // dual-raster flag is on.
    const meshB = new THREE.LineSegments(geom, this.materialB);
    meshB.frustumCulled = false;
    meshB.visible = this.settings.get('dualRasterEnabled');
    this.group.add(meshB);
    this.meshB = meshB;
  }

  // -------------------- settings -> uniforms --------------------

  private bindSettings(): void {
    const s = this.settings;
    const live = this.live;
    const u = this.uniforms;
    const uB = this.uniformsB;

    // Non-modulatable params keep using `settings.subscribe` directly.
    // Modulatable params route through `live.subscribe` so the renderer
    // sees `(base + sum_offsets) * product_factors` instead of just
    // `Settings.get(key)`. The two reads are intentional — the UI knob
    // continues to read/write the BASE via `settings`.
    //
    // v23: params SHARED between rasters update both uniform sets;
    // raster B's independent deflection/luminance params bind the b*
    // keys to uB further down.
    s.subscribe('mirrorH', (v) => {
      (u.uMirror.value as THREE.Vector2).setX(v ? 1 : 0);
      (uB.uMirror.value as THREE.Vector2).setX(v ? 1 : 0);
    });
    s.subscribe('mirrorV', (v) => {
      (u.uMirror.value as THREE.Vector2).setY(v ? 1 : 0);
      (uB.uMirror.value as THREE.Vector2).setY(v ? 1 : 0);
    });

    live.subscribe('focus',     (v) => { u.uFocus.value = v; uB.uFocus.value = v; });
    live.subscribe('threshold', (v) => { u.uThreshold.value = v; });
    live.subscribe('contrast',  (v) => { u.uContrast.value = v; });
    live.subscribe('gamma',     (v) => { u.uGamma.value = v; });

    live.subscribe('zPush',   (v) => { u.uZPush.value = v; });
    live.subscribe('zBias',   (v) => { u.uZBias.value = v; });
    s.subscribe('zInvert', (v) => { u.uZInvert.value = v ? 1 : 0; uB.uZInvert.value = v ? 1 : 0; });

    live.subscribe('hLinearity', (v) => (u.uLinearity.value as THREE.Vector2).setX(v));
    live.subscribe('vLinearity', (v) => (u.uLinearity.value as THREE.Vector2).setY(v));

    live.subscribe('aspect', (v) => { u.uAspect.value = v; uB.uAspect.value = v; });
    live.subscribe('hSize',  (v) => (u.uSize.value as THREE.Vector2).setX(v));
    live.subscribe('vSize',  (v) => (u.uSize.value as THREE.Vector2).setY(v));

    live.subscribe('hPos', (v) => (u.uPos.value as THREE.Vector2).setX(v));
    live.subscribe('vPos', (v) => (u.uPos.value as THREE.Vector2).setY(v));

    live.subscribe('hCenter', (v) => (u.uCenter.value as THREE.Vector2).setX(v));
    live.subscribe('vCenter', (v) => (u.uCenter.value as THREE.Vector2).setY(v));

    s.subscribe('rotate90', (v) => { u.uRotate90.value = v ? 1 : 0; uB.uRotate90.value = v ? 1 : 0; });
    // v21: continuous rotation knob — degrees in Settings, radians in the
    // shader. Modulatable, so it reads live.
    live.subscribe('rotation', (v) => { u.uRotation.value = (v * Math.PI) / 180; });
    live.subscribe('hSpin', (v) => { u.uHSpin.value = v; });
    live.subscribe('vSpin', (v) => { u.uVSpin.value = v; });
    s.subscribe('hReverse', (v) => { u.uHReverse.value = v ? 1 : 0; uB.uHReverse.value = v ? 1 : 0; });
    s.subscribe('vReverse', (v) => { u.uVReverse.value = v ? 1 : 0; uB.uVReverse.value = v ? 1 : 0; });

    live.subscribe('skip', (v) => { u.uSkip.value = v; uB.uSkip.value = v; });

    live.subscribe('intensity', (v) => { u.uIntensity.value = v; });

    // ---- v23: raster B independent params (b* keys -> uB) ----
    live.subscribe('bThreshold', (v) => { uB.uThreshold.value = v; });
    live.subscribe('bContrast',  (v) => { uB.uContrast.value = v; });
    live.subscribe('bGamma',     (v) => { uB.uGamma.value = v; });
    live.subscribe('bZPush',     (v) => { uB.uZPush.value = v; });
    live.subscribe('bZBias',     (v) => { uB.uZBias.value = v; });
    live.subscribe('bHLinearity', (v) => (uB.uLinearity.value as THREE.Vector2).setX(v));
    live.subscribe('bVLinearity', (v) => (uB.uLinearity.value as THREE.Vector2).setY(v));
    live.subscribe('bHSize',   (v) => (uB.uSize.value as THREE.Vector2).setX(v));
    live.subscribe('bVSize',   (v) => (uB.uSize.value as THREE.Vector2).setY(v));
    live.subscribe('bHPos',    (v) => (uB.uPos.value as THREE.Vector2).setX(v));
    live.subscribe('bVPos',    (v) => (uB.uPos.value as THREE.Vector2).setY(v));
    live.subscribe('bHCenter', (v) => (uB.uCenter.value as THREE.Vector2).setX(v));
    live.subscribe('bVCenter', (v) => (uB.uCenter.value as THREE.Vector2).setY(v));
    live.subscribe('bRotation', (v) => { uB.uRotation.value = (v * Math.PI) / 180; });
    live.subscribe('bHSpin',   (v) => { uB.uHSpin.value = v; });
    live.subscribe('bVSpin',   (v) => { uB.uVSpin.value = v; });
    live.subscribe('bIntensity', (v) => { uB.uIntensity.value = v; });

    // ---- v23: dual-raster controls ----
    const applyDualMode = (): void => {
      const enabled = s.get('dualRasterEnabled');
      const mode = enabled ? (s.get('dualMode') === 'alternate' ? 2 : 1) : 0;
      u.uDualMode.value = mode;
      uB.uDualMode.value = mode;
      if (this.meshB) this.meshB.visible = enabled;
    };
    s.subscribe('dualRasterEnabled', applyDualMode);
    s.subscribe('dualMode', applyDualMode);
    live.subscribe('dualTracePos', (v) => {
      u.uWipe.value = v;
      uB.uWipe.value = v;
    });

    s.subscribe('colorMode', (mode) => {
      u.uColorMode.value = COLOR_MODE_INDEX[mode];
      uB.uColorMode.value = COLOR_MODE_INDEX[mode];
      this.applyTint(mode, this.settings.get('customTint'));
    });
    s.subscribe('customTint', (hex) => this.applyTint(this.settings.get('colorMode'), hex));

    s.subscribe('backgroundColor', (hex) => {
      const bg = new THREE.Color(hex);
      this.scene.background = bg;
    });

    s.subscribe('cols',     () => this.rebuildGeometry());
    s.subscribe('scanRate', () => this.rebuildGeometry());

    s.subscribe('renderMode', (mode) => {
      const wire = mode === 'wireframe';
      for (const m of [this.material, this.materialB]) {
        m.blending = wire ? THREE.NormalBlending : THREE.AdditiveBlending;
        m.depthWrite = wire;
      }
    });

    s.subscribe('audioSpectrum', (spec) => {
      for (const set of [u, uB]) {
        set.uSpectrumOn.value     = spec.enabled ? 1 : 0;
        set.uSpectrumAmount.value = spec.amount;
        set.uSpectrumStride.value = spec.stride;
      }
    });
    live.subscribe('spectrumAmount', (v) => { u.uSpectrumAmount.value = v; uB.uSpectrumAmount.value = v; });
    live.subscribe('spectrumStride', (v) => { u.uSpectrumStride.value = v; uB.uSpectrumStride.value = v; });
    s.subscribe('audioBandCount', (n) => this.ensureSpectrumTexture(n));
  }

  private applyTint(mode: ColorMode, customHex: string): void {
    for (const set of [this.uniforms, this.uniformsB]) {
      (set.uTint.value as THREE.Color).set(tintHexFor(mode, customHex) ?? '#ffffff');
    }
  }
}
