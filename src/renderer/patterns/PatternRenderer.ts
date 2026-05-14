/**
 * Pattern Generator renderer — owns the offscreen pipeline that turns
 * the user's pattern selection into a `THREE.Texture` consumable by
 * the DCU's `uVideo` uniform.
 *
 * Per frame (when `patternEnabled === true`):
 *   1. (Oscilloscope only) sample the configured signal source and
 *      upload the scope buffer to its DataTexture.
 *   2. Render the selected pattern fragment shader -> `patternRT`.
 *   3. (Oscilloscope only) blend `patternRT` over a persistent trail
 *      RT and copy back, implementing phosphor-style decay.
 *   4. Render the compositor shader -> `compositRT`, sampling
 *      `patternRT` and the live `videoTexture`.
 *   5. Bind `compositRT.texture` as the DCU's video input via
 *      `RuttEtraScene.setExternalVideoTexture`.
 *
 * On `patternEnabled === false`, `bypass()` restores the live
 * `<video>` source by calling `RuttEtraScene.attachVideo()`.
 *
 * No persistent state per-pattern beyond the lazy `Map<PatternKind,
 * ShaderMaterial>`; each material's uniforms are reset every frame from
 * `LiveValuesStore` (so modulation flows transparently).
 */

import * as THREE from 'three';

import { SettingsStore, PatternKind, PatternBlendMode, PatternScopeSourceKind } from '../../state/Settings';
import { LiveValuesStore } from '../../modulation/LiveValues';
import { RuttEtraScene } from '../RuttEtra';

import {
  PATTERN_REGISTRY, PATTERN_QUAD_VERT_SRC, PATTERN_COMPOSITOR_FRAG_SRC,
  BLEND_MODE_INDEX, PatternDef,
} from './PatternRegistry';
import { OscilloscopeBuffer } from './OscilloscopeBuffer';
import { PatternSignalBus } from './PatternSignalBus';

/** Settings -> uniform name table. Keep in sync with the shader uniforms. */
const SETTINGS_TO_UNIFORM: Record<string, string> = {
  patternBrightness:    'uBrightness',
  patternContrast:      'uContrast',
  patternFrequency:     'uFrequency',
  patternPhase:         'uPhase',
  patternScale:         'uScale',
  patternThickness:     'uThickness',
  patternDensity:       'uDensity',
  patternFreqRatio:     'uFreqRatio',
  patternPhaseOffset:   'uPhaseOffset',
  patternArms:          'uArms',
  patternOctaves:       'uOctaves',
  patternPointDensity:  'uPointDensity',
  patternScopeSweep:    'uScopeSweep',
  patternScopeThickness:'uScopeThickness',
  patternScopeBeamHue:  'uScopeBeamHue',
};

const AXIS_INDEX: Record<'h' | 'v' | 'both' | 'radial', number> = {
  h: 0, v: 1, both: 2, radial: 3,
};
const GRAD_SHAPE_INDEX: Record<'linear' | 'radial', number> = {
  linear: 0, radial: 1,
};

/**
 * Caller-supplied callback that fills `buf` with a frame's worth of
 * scope samples for the given source kind + ref. The renderer calls
 * this once per frame in oscilloscope mode. The implementation
 * decides whether to use `pushSample` (single-sample sources) or
 * `writeBlock` (audio-rate sources).
 */
export type ScopeSampler = (
  buf: OscilloscopeBuffer,
  kind: PatternScopeSourceKind,
  ref: string,
) => void;

const SCOPE_BUFFER_LENGTH = 1024;

export class PatternRenderer {
  private patternRT: THREE.WebGLRenderTarget;
  private compositRT: THREE.WebGLRenderTarget;
  private trailRT: THREE.WebGLRenderTarget;
  private trailPrevRT: THREE.WebGLRenderTarget;

  private fsScene = new THREE.Scene();
  private fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fsQuad: THREE.Mesh;

  private materials = new Map<PatternKind, THREE.ShaderMaterial>();

  private compositor: THREE.ShaderMaterial;
  private trailMaterial: THREE.ShaderMaterial;
  private copyMaterial: THREE.ShaderMaterial;

  private scopeBuf: OscilloscopeBuffer;
  private scopeSampler: ScopeSampler | null = null;

  private width: number;
  private height: number;

  /**
   * Track which RuttEtra texture binding we last set so we know
   * whether `bypass()` actually has work to do. The setting subscriber
   * in main.ts listens to `patternEnabled` and calls `bypass()`, but
   * defensive: bypass is idempotent.
   */
  private boundExternal = false;

  /** Last pattern kind whose `compute()` ran. We track this so a
   *  kind-switch can clear the previous pattern's signals from the bus
   *  in one shot — otherwise stale Lissajous X / Sine Bands wave / etc.
   *  would keep driving any slots that targeted them after a switch. */
  private lastPublishedKind: PatternKind | null = null;

  /** Previous frame's most-recent scope sample. Used by
   *  `detectScopeTrigger` to detect a rising-edge crossing per frame.
   *  Independent of the buffer's intra-window trigger alignment used
   *  for visual stability. */
  private scopePrevSample = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private settings: SettingsStore,
    private live: LiveValuesStore,
    private ruttEtra: RuttEtraScene,
    private signalBus: PatternSignalBus,
    width: number,
    height: number,
  ) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);

    const rtOpts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      // Match VideoTexture's color space so blend modes operate in the
      // same space the DCU samples in.
      colorSpace: THREE.SRGBColorSpace,
    };
    this.patternRT  = new THREE.WebGLRenderTarget(this.width, this.height, rtOpts);
    this.compositRT = new THREE.WebGLRenderTarget(this.width, this.height, rtOpts);
    this.trailRT    = new THREE.WebGLRenderTarget(this.width, this.height, rtOpts);
    this.trailPrevRT= new THREE.WebGLRenderTarget(this.width, this.height, rtOpts);

    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial());
    this.fsScene.add(this.fsQuad);

    this.scopeBuf = new OscilloscopeBuffer(SCOPE_BUFFER_LENGTH);

    this.compositor = new THREE.ShaderMaterial({
      uniforms: {
        uPattern:   { value: null },
        uVideo:     { value: null },
        uBlendMode: { value: 0 },
        uMix:       { value: 1 },
        uHasVideo:  { value: 0 },
      },
      vertexShader: PATTERN_QUAD_VERT_SRC,
      fragmentShader: PATTERN_COMPOSITOR_FRAG_SRC,
    });

    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null },
        uPrev:    { value: null },
        uDecay:   { value: 0.0 },
      },
      vertexShader: PATTERN_QUAD_VERT_SRC,
      fragmentShader: TRAIL_FRAG,
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: PATTERN_QUAD_VERT_SRC,
      fragmentShader: COPY_FRAG,
    });
  }

  /** Configure the source-sampler callback. See `ScopeSampler`. */
  setScopeSampler(fn: ScopeSampler | null): void {
    this.scopeSampler = fn;
  }

  /** Resize all render targets to `(w, h)`. */
  setSize(w: number, h: number): void {
    this.width = Math.max(1, w | 0);
    this.height = Math.max(1, h | 0);
    this.patternRT.setSize(this.width, this.height);
    this.compositRT.setSize(this.width, this.height);
    this.trailRT.setSize(this.width, this.height);
    this.trailPrevRT.setSize(this.width, this.height);
    if (this.boundExternal) {
      this.ruttEtra.setExternalVideoTexture(
        this.compositRT.texture, this.width, this.height,
      );
    }
  }

  /**
   * Per-frame entry. The caller should pass the scene's current
   * `videoTexture` (may be null if no source is active) — the
   * compositor uses it via `uVideo` / `uHasVideo`.
   */
  tick(timeSec: number, dt: number, videoTexture: THREE.Texture | null): void {
    const s = this.settings.all;
    const kind = s.patternKind;
    const def = PATTERN_REGISTRY[kind];
    if (!def) return;

    let triggerHit = false;
    if (kind === 'oscilloscope' && this.scopeSampler) {
      this.scopeSampler(this.scopeBuf, s.patternScopeSourceKind, s.patternScopeSourceRef);
      const triggerLevel = this.live.getLive('patternScopeTrigger');
      // Detect a rising-edge crossing between LAST frame's most-recent
      // sample and THIS frame's most-recent sample. Independent of the
      // buffer's intra-window alignment used for visual stability.
      triggerHit = triggerLevel !== 0 && this.detectScopeTrigger(triggerLevel);
      this.scopeBuf.uploadIfDirty(triggerLevel);
    }

    // Publish CPU-side internal signals BEFORE rendering so consumers
    // reading the bus this frame see fresh values. Two-path design:
    // visible pattern uses the shader; the published signal uses this
    // CPU mirror — both share `live` parameter values, so they stay
    // perfectly in lockstep.
    this.publishSignals(def, timeSec, dt, triggerHit);

    const mat = this.getOrCreateMaterial(def);
    this.bindUniforms(mat, def, timeSec);

    // 1. Render pattern -> patternRT (or trailRT first for scope)
    const oldRT = this.renderer.getRenderTarget();
    const isScope = kind === 'oscilloscope';

    this.fsQuad.material = mat;
    this.renderer.setRenderTarget(this.patternRT);
    this.renderer.clear();
    this.renderer.render(this.fsScene, this.fsCamera);

    if (isScope) {
      // Phosphor decay: trailRT = current + prevTrail * decay
      const decay = clamp01(this.live.getLive('patternScopePersist'));
      this.trailMaterial.uniforms.uCurrent.value = this.patternRT.texture;
      this.trailMaterial.uniforms.uPrev.value    = this.trailPrevRT.texture;
      this.trailMaterial.uniforms.uDecay.value   = decay;
      this.fsQuad.material = this.trailMaterial;
      this.renderer.setRenderTarget(this.trailRT);
      this.renderer.clear();
      this.renderer.render(this.fsScene, this.fsCamera);

      // Copy trailRT -> trailPrevRT for next frame.
      this.copyMaterial.uniforms.tDiffuse.value = this.trailRT.texture;
      this.fsQuad.material = this.copyMaterial;
      this.renderer.setRenderTarget(this.trailPrevRT);
      this.renderer.clear();
      this.renderer.render(this.fsScene, this.fsCamera);
    }

    // 2. Render compositor -> compositRT
    const patternTexture = isScope ? this.trailRT.texture : this.patternRT.texture;
    this.compositor.uniforms.uPattern.value = patternTexture;
    this.compositor.uniforms.uVideo.value = videoTexture;
    this.compositor.uniforms.uHasVideo.value = videoTexture ? 1 : 0;
    this.compositor.uniforms.uBlendMode.value = blendIdx(s.patternBlendMode);
    this.compositor.uniforms.uMix.value = clamp01(this.live.getLive('patternMix'));
    this.fsQuad.material = this.compositor;
    this.renderer.setRenderTarget(this.compositRT);
    this.renderer.clear();
    this.renderer.render(this.fsScene, this.fsCamera);

    this.renderer.setRenderTarget(oldRT);

    // 3. Bind composite as the DCU's video texture.
    this.ruttEtra.setExternalVideoTexture(
      this.compositRT.texture, this.width, this.height,
    );
    this.boundExternal = true;
  }

  /**
   * Restore the live video source as the DCU's input. Called when the
   * user toggles `patternEnabled` off. Idempotent.
   */
  bypass(): void {
    if (!this.boundExternal) return;
    this.ruttEtra.attachVideo();
    this.boundExternal = false;
    this.scopeBuf.clear();
    // Drop every published signal — otherwise stale Lissajous X / scope
    // mean / etc. would keep driving slots that targeted them.
    this.signalBus.clear();
    this.lastPublishedKind = null;
    this.scopePrevSample = 0;
  }

  dispose(): void {
    this.patternRT.dispose();
    this.compositRT.dispose();
    this.trailRT.dispose();
    this.trailPrevRT.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.compositor.dispose();
    this.trailMaterial.dispose();
    this.copyMaterial.dispose();
    this.scopeBuf.dispose();
    (this.fsQuad.geometry as THREE.BufferGeometry).dispose();
  }

  // -------------------- private --------------------

  private getOrCreateMaterial(def: PatternDef): THREE.ShaderMaterial {
    const existing = this.materials.get(def.kind);
    if (existing) return existing;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.makeUniformsFor(def),
      vertexShader: PATTERN_QUAD_VERT_SRC,
      fragmentShader: def.fragSrc,
    });
    this.materials.set(def.kind, mat);
    return mat;
  }

  /**
   * Build the initial uniform set for a pattern. We declare every
   * uniform the shader could possibly read so three.js ignores the
   * unused ones; `bindUniforms` then refreshes only the relevant
   * values per frame.
   */
  private makeUniformsFor(def: PatternDef): Record<string, THREE.IUniform> {
    return {
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(this.width, this.height) },
      uBrightness: { value: 1 },
      uContrast:   { value: 1 },
      uFrequency:  { value: 1 },
      uPhase:      { value: 0 },
      uScale:      { value: 1 },
      uThickness:  { value: 0.1 },
      uDensity:    { value: 8 },
      uFreqRatio:  { value: 1 },
      uPhaseOffset:{ value: 0 },
      uArms:       { value: 4 },
      uOctaves:    { value: 4 },
      uPointDensity:{ value: 8 },
      uAxis:       { value: 0 },
      uGradientShape: { value: 0 },
      // Oscilloscope-only.
      uScopeBuffer:       { value: def.kind === 'oscilloscope' ? this.scopeBuf.texture : null },
      uScopeBufferLength: { value: this.scopeBuf.length },
      uScopeSweep:        { value: 1 },
      uScopeThickness:    { value: 1.5 },
      uScopeBeamHue:      { value: 0.33 },
    };
  }

  private bindUniforms(mat: THREE.ShaderMaterial, def: PatternDef, timeSec: number): void {
    const u = mat.uniforms;
    u.uTime.value = timeSec;
    (u.uResolution.value as THREE.Vector2).set(this.width, this.height);

    // Pull every numeric param the shader cares about from LiveValues
    // (which handles base + modulation). Categorical enums come straight
    // from settings.
    for (const key of def.paramKeys) {
      const uniformName = SETTINGS_TO_UNIFORM[key];
      if (uniformName && uniformName in u) {
        u[uniformName].value = this.live.getLive(key as string);
      }
    }
    // Categorical mappings (always evaluate; cheap).
    if ('uAxis' in u) u.uAxis.value = AXIS_INDEX[this.settings.get('patternAxis')] ?? 0;
    if ('uGradientShape' in u) u.uGradientShape.value = GRAD_SHAPE_INDEX[this.settings.get('patternGradientShape')] ?? 0;

    if (def.kind === 'oscilloscope') {
      u.uScopeBuffer.value = this.scopeBuf.texture;
      u.uScopeBufferLength.value = this.scopeBuf.length;
    }
  }

  /**
   * Run the active pattern's CPU compute mirror and write each output
   * to the signal bus. Also clears any signals belonging to a previous
   * pattern when the kind changes, so consumers can't read stale
   * values from the wrong pattern.
   */
  private publishSignals(
    def: PatternDef, timeSec: number, dt: number, triggerHit: boolean,
  ): void {
    if (this.lastPublishedKind !== null && this.lastPublishedKind !== def.kind) {
      // The bus could be smarter about per-pattern namespacing, but
      // wiping is simplest and correct — only one pattern is active.
      this.signalBus.clear();
    }
    this.lastPublishedKind = def.kind;

    if (!def.outputs || !def.compute) return;
    const frame = {
      time: timeSec,
      dt,
      getLive: (key: string) => this.live.getLive(key as Parameters<LiveValuesStore['getLive']>[0]),
      scope: def.kind === 'oscilloscope' ? this.scopeBuf : null,
      triggerHit,
    };
    const out = def.compute(frame);
    for (const sig of def.outputs) {
      const v = out[sig.id];
      this.signalBus.set(
        PatternSignalBus.id(def.kind, sig.id),
        typeof v === 'number' ? v : 0,
      );
    }
  }

  /**
   * Detect a rising-edge crossing of `triggerLevel` between the
   * previous frame's last sample and this frame's last sample. Drives
   * the oscilloscope's `trigger` output (a one-frame pulse at 1.0).
   * Independent of the buffer's intra-window trigger alignment which
   * exists purely for visual stability of the trace.
   */
  private detectScopeTrigger(triggerLevel: number): boolean {
    const cur = this.scopeBuf.getLatestSample();
    const prev = this.scopePrevSample;
    this.scopePrevSample = cur;
    return prev <= triggerLevel && cur > triggerLevel;
  }
}

function blendIdx(mode: PatternBlendMode): number {
  return BLEND_MODE_INDEX[mode] ?? 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// Trivial fragment shaders the renderer needs but don't merit their own files.
const TRAIL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uPrev;
uniform float uDecay;
void main() {
  vec3 cur = texture2D(uCurrent, vUv).rgb;
  vec3 prv = texture2D(uPrev,    vUv).rgb;
  // Additive trail: keep brightest of (current, decayed previous).
  vec3 outRgb = max(cur, prv * clamp(uDecay, 0.0, 0.99));
  gl_FragColor = vec4(outRgb, 1.0);
}
`;

const COPY_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;
