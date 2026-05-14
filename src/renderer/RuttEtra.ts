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
import { LiveValuesStore } from '../modulation/LiveValues';

const COLOR_MODE_INDEX: Record<ColorMode, number> = {
  grayscale: 0,
  phosphorGreen: 1,
  phosphorAmber: 1,
  phosphorCustom: 1,
  video: 2,
};

const PHOSPHOR_GREEN = new THREE.Color('#5fff85');
const PHOSPHOR_AMBER = new THREE.Color('#ffb347');

export class RuttEtraScene {
  readonly scene = new THREE.Scene();
  readonly group = new THREE.Group();
  videoTexture: THREE.VideoTexture | null = null;

  private material!: THREE.ShaderMaterial;
  private mesh: THREE.LineSegments | null = null;
  private currentCols = 0;
  private currentRows = 0;

  private uniforms!: { [key: string]: THREE.IUniform };

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
    this.updateTexel();
  }

  /** Update the resolution-of-the-video uniform when metadata loads. */
  updateTexel(): void {
    const w = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    (this.uniforms.uVideoTexel.value as THREE.Vector2).set(1 / w, 1 / h);
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
  }

  // -------------------- internals --------------------

  private createMaterial(): void {
    this.uniforms = {
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
    };

    this.ensureSpectrumTexture(this.spectrumBandCount);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertSrc,
      fragmentShader: fragSrc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  /** (Re)build the scan-line geometry with current cols/rows. */
  private rebuildGeometry(): void {
    const cols = Math.max(2, this.settings.get('cols') | 0);
    const rows = Math.max(2, this.settings.get('scanRate') | 0);

    if (cols === this.currentCols && rows === this.currentRows) return;
    this.currentCols = cols;
    this.currentRows = rows;
    this.uniforms.uRows.value = rows;

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
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
  }

  // -------------------- settings -> uniforms --------------------

  private bindSettings(): void {
    const s = this.settings;
    const live = this.live;
    const u = this.uniforms;

    // Non-modulatable params keep using `settings.subscribe` directly.
    // Modulatable params route through `live.subscribe` so the renderer
    // sees `(base + sum_offsets) * product_factors` instead of just
    // `Settings.get(key)`. The two reads are intentional — the UI knob
    // continues to read/write the BASE via `settings`.
    s.subscribe('mirrorH', (v) => (u.uMirror.value as THREE.Vector2).setX(v ? 1 : 0));
    s.subscribe('mirrorV', (v) => (u.uMirror.value as THREE.Vector2).setY(v ? 1 : 0));

    live.subscribe('focus',     (v) => { u.uFocus.value = v; });
    live.subscribe('threshold', (v) => { u.uThreshold.value = v; });
    live.subscribe('contrast',  (v) => { u.uContrast.value = v; });
    live.subscribe('gamma',     (v) => { u.uGamma.value = v; });

    live.subscribe('zPush',   (v) => { u.uZPush.value = v; });
    live.subscribe('zBias',   (v) => { u.uZBias.value = v; });
    s.subscribe('zInvert', (v) => { u.uZInvert.value = v ? 1 : 0; });

    live.subscribe('hLinearity', (v) => (u.uLinearity.value as THREE.Vector2).setX(v));
    live.subscribe('vLinearity', (v) => (u.uLinearity.value as THREE.Vector2).setY(v));

    live.subscribe('aspect', (v) => { u.uAspect.value = v; });
    live.subscribe('hSize',  (v) => (u.uSize.value as THREE.Vector2).setX(v));
    live.subscribe('vSize',  (v) => (u.uSize.value as THREE.Vector2).setY(v));

    live.subscribe('hPos', (v) => (u.uPos.value as THREE.Vector2).setX(v));
    live.subscribe('vPos', (v) => (u.uPos.value as THREE.Vector2).setY(v));

    live.subscribe('hCenter', (v) => (u.uCenter.value as THREE.Vector2).setX(v));
    live.subscribe('vCenter', (v) => (u.uCenter.value as THREE.Vector2).setY(v));

    s.subscribe('rotate90', (v) => { u.uRotate90.value = v ? 1 : 0; });
    live.subscribe('hSpin', (v) => { u.uHSpin.value = v; });
    live.subscribe('vSpin', (v) => { u.uVSpin.value = v; });
    s.subscribe('hReverse', (v) => { u.uHReverse.value = v ? 1 : 0; });
    s.subscribe('vReverse', (v) => { u.uVReverse.value = v ? 1 : 0; });

    live.subscribe('skip', (v) => { u.uSkip.value = v; });

    live.subscribe('intensity', (v) => { u.uIntensity.value = v; });

    s.subscribe('colorMode', (mode) => {
      u.uColorMode.value = COLOR_MODE_INDEX[mode];
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
      if (mode === 'wireframe') {
        this.material.blending = THREE.NormalBlending;
        this.material.depthWrite = true;
      } else {
        this.material.blending = THREE.AdditiveBlending;
        this.material.depthWrite = false;
      }
    });

    s.subscribe('audioSpectrum', (spec) => {
      u.uSpectrumOn.value     = spec.enabled ? 1 : 0;
      u.uSpectrumAmount.value = spec.amount;
      u.uSpectrumStride.value = spec.stride;
    });
    live.subscribe('spectrumAmount', (v) => { u.uSpectrumAmount.value = v; });
    live.subscribe('spectrumStride', (v) => { u.uSpectrumStride.value = v; });
    s.subscribe('audioBandCount', (n) => this.ensureSpectrumTexture(n));
  }

  private applyTint(mode: ColorMode, customHex: string): void {
    const tint = this.uniforms.uTint.value as THREE.Color;
    switch (mode) {
      case 'phosphorGreen':  tint.copy(PHOSPHOR_GREEN); break;
      case 'phosphorAmber':  tint.copy(PHOSPHOR_AMBER); break;
      case 'phosphorCustom': tint.set(customHex); break;
      default:               tint.set('#ffffff');
    }
  }
}
