/**
 * Video Source A/B compositor — the Patch Bay's Composite AND Dual
 * Raster nodes made real. Reuses the Pattern Generator's existing
 * two-texture blend pass
 * (`compositor.frag.glsl` is already video-agnostic: `uPattern`/`uVideo`/
 * `uBlendMode`/`uMix`/`uHasVideo`) rather than shipping a second copy of
 * the shader — see `PatternRenderer.tick()`'s identical recipe.
 *
 * Routing (`videoRendererIn`/`videoCompositeInA`/`videoCompositeInB`)
 * lives in Settings so it can be driven by draggable cables in the
 * Patch Bay, exactly like every other patch concept in this app.
 * `videoRendererIn: 'sourceA'` is the pre-existing single-source
 * behavior, byte for byte — `resolveVideoInput()` returns `null` in
 * that case and the caller does nothing extra (zero cost, nothing
 * changes until a cable is actually dragged — principle 5, coexistence
 * over replacement).
 *
 * Unlike the Pattern Generator's `compositRT`, this pass is NOT sized
 * to the render target — it only needs to represent a video signal, so
 * it's sized from the two sources' own native video dimensions (same
 * "video texel size is independent of render resolution" convention
 * `RuttEtraScene.updateTexel()` already uses for the single-source
 * path). That sidesteps threading a new dependency through
 * `ResolutionManager`.
 */

import * as THREE from 'three';
import { SettingsStore, PatternBlendMode } from '../state/Settings';
import { LiveValuesStore } from '../modulation/LiveValues';
import { PATTERN_QUAD_VERT_SRC, PATTERN_COMPOSITOR_FRAG_SRC, BLEND_MODE_INDEX } from './patterns/PatternRegistry';

export interface VideoCompositeResult {
  texture: THREE.Texture;
  width: number;
  height: number;
}

/** The three sources a routing input can reference (`'none'` = unplugged). */
export type VideoSourceRef = 'sourceA' | 'sourceB' | 'composite' | 'pattern' | 'none';

/** Settings keys that can reference the Pattern Generator as a source. */
const PATTERN_ROUTE_KEYS = ['videoRendererIn', 'videoCompositeInA', 'videoCompositeInB', 'videoDualRasterInA', 'videoDualRasterInB'] as const;

/** True when the Pattern Generator's OUT is patched anywhere (v1.31) —
 *  it then renders as a picture source instead of overlaying. */
export function isPatternRouted(get: (k: typeof PATTERN_ROUTE_KEYS[number]) => string): boolean {
  return PATTERN_ROUTE_KEYS.some((k) => get(k) === 'pattern');
}

export class VideoCompositor {
  private rt: THREE.WebGLRenderTarget;
  private fsScene = new THREE.Scene();
  private fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fsQuad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private width = 640;
  private height = 480;
  /** Null-sampler footgun guard — a texture uniform assigned `null` can
   *  warn/misbehave depending on the WebGL backend; an inactive input
   *  binds this instead, matching the shader's own "no source = black"
   *  convention (compositor.frag.glsl's `uHasVideo` gate). */
  private blackTex: THREE.DataTexture;
  /** This frame's Pattern Generator output, when it's patched as a source. */
  private patternSrc: VideoCompositeResult | null = null;

  /** Set each frame before resolving (null when the pattern isn't rendering). */
  setPatternSource(src: VideoCompositeResult | null): void {
    this.patternSrc = src;
  }

  constructor(
    private renderer: THREE.WebGLRenderer,
    private settings: SettingsStore,
    private live: LiveValuesStore,
  ) {
    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial());
    this.fsScene.add(this.fsQuad);
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.blackTex.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPattern:   { value: this.blackTex },
        uVideo:     { value: this.blackTex },
        uBlendMode: { value: 0 },
        uMix:       { value: 1 },
        uHasVideo:  { value: 0 },
      },
      vertexShader: PATTERN_QUAD_VERT_SRC,
      fragmentShader: PATTERN_COMPOSITOR_FRAG_SRC,
    });
  }

  private setSize(w: number, h: number): void {
    const nw = Math.max(1, w | 0);
    const nh = Math.max(1, h | 0);
    if (nw === this.width && nh === this.height) return;
    this.width = nw;
    this.height = nh;
    this.rt.setSize(this.width, this.height);
  }

  /** Runs the A/B blend pass (Composite node) and returns its result.
   *  Shared by `resolveVideoInput('composite')` and any Dual Raster
   *  input set to 'composite' — both read the SAME Composite-node
   *  settings (`videoCompositeInA/InB/BlendMode/Mix`), so there's only
   *  ever one "the composite" image in a given frame regardless of how
   *  many routing slots reference it. */
  private renderComposite(
    texA: THREE.Texture | null, aActive: boolean,
    texB: THREE.Texture | null, bActive: boolean,
    aWidth: number, aHeight: number, bWidth: number, bHeight: number,
  ): VideoCompositeResult {
    const pick = (which: VideoSourceRef): { tex: THREE.Texture; active: boolean } => {
      if (which === 'sourceA') return { tex: texA ?? this.blackTex, active: aActive };
      if (which === 'sourceB') return { tex: texB ?? this.blackTex, active: bActive };
      if (which === 'pattern' && this.patternSrc) return { tex: this.patternSrc.texture, active: true };
      return { tex: this.blackTex, active: false };
    };
    const a = pick(this.settings.get('videoCompositeInA'));
    const b = pick(this.settings.get('videoCompositeInB'));
    this.setSize(Math.max(aWidth || 640, bWidth || 640), Math.max(aHeight || 480, bHeight || 480));

    this.material.uniforms.uVideo.value = a.tex;
    this.material.uniforms.uHasVideo.value = a.active ? 1 : 0;
    this.material.uniforms.uPattern.value = b.active ? b.tex : this.blackTex;
    this.material.uniforms.uBlendMode.value = BLEND_MODE_INDEX[this.settings.get('videoCompositeBlendMode') as PatternBlendMode];
    this.material.uniforms.uMix.value = Math.min(1, Math.max(0, this.live.getLive('videoCompositeMix')));

    const oldRT = this.renderer.getRenderTarget();
    this.fsQuad.material = this.material;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.fsScene, this.fsCamera);
    this.renderer.setRenderTarget(oldRT);

    return { texture: this.rt.texture, width: this.width, height: this.height };
  }

  /** Resolve a single named source ref to a texture, running the
   *  Composite pass on demand for `'composite'`. `'none'` (an unplugged
   *  Dual Raster input) resolves to null — the caller decides what "no
   *  signal" means for its slot (Renderer IN never sees 'none': it
   *  normals to 'sourceA' before reaching here). */
  private resolveRef(
    ref: VideoSourceRef,
    texA: THREE.Texture | null, aActive: boolean,
    texB: THREE.Texture | null, bActive: boolean,
    aWidth: number, aHeight: number, bWidth: number, bHeight: number,
  ): VideoCompositeResult | null {
    if (ref === 'sourceA') return texA ? { texture: texA, width: aWidth || 640, height: aHeight || 480 } : null;
    if (ref === 'sourceB') return texB ? { texture: texB, width: bWidth || 640, height: bHeight || 480 } : null;
    if (ref === 'composite') return this.renderComposite(texA, aActive, texB, bActive, aWidth, aHeight, bWidth, bHeight);
    if (ref === 'pattern') return this.patternSrc;
    return null; // 'none'
  }

  /**
   * Resolves this frame's DCU video input per the Patch Bay's RENDERER
   * IN wiring. `texA`/`texB` are the two sources' live `THREE.
   * VideoTexture`s (or null before either has ever loaded metadata);
   * `aActive`/`bActive` mirror `sourceKind !== 'none'` for each.
   *
   * Returns `null` for the default `videoRendererIn: 'sourceA'` (or
   * `'dualRaster'`, handled separately by `resolveDualRaster` — this
   * method only owns the single-texture routing choices) — the caller
   * should leave RuttEtra's existing binding untouched in that case
   * (zero cost). Non-null means the caller must bind the returned
   * texture (`RuttEtraScene.setExternalVideoTexture`).
   */
  resolveVideoInput(
    texA: THREE.Texture | null, aActive: boolean,
    texB: THREE.Texture | null, bActive: boolean,
    aWidth: number, aHeight: number, bWidth: number, bHeight: number,
  ): VideoCompositeResult | null {
    const routeIn = this.settings.get('videoRendererIn');
    if (routeIn === 'sourceA' || routeIn === 'dualRaster') return null;
    if (routeIn === 'pattern') return this.patternSrc; // null → normal to Source A
    if (routeIn === 'sourceB') {
      if (!texB) return null; // B has never loaded metadata — normal to sourceA
      return { texture: texB, width: bWidth || 640, height: bHeight || 480 };
    }
    return this.renderComposite(texA, aActive, texB, bActive, aWidth, aHeight, bWidth, bHeight);
  }

  /**
   * Resolves raster A's and raster B's independent video inputs for
   * the Dual Raster node (`videoRendererIn === 'dualRaster'`). Returns
   * null when Dual Raster isn't the active routing choice. An unwired
   * side (`videoDualRasterInA/InB === 'none'`) resolves to null within
   * the result — the caller decides the fallback (mirroring raster A,
   * same as the pre-existing "both rasters share one source" default).
   */
  resolveDualRaster(
    texA: THREE.Texture | null, aActive: boolean,
    texB: THREE.Texture | null, bActive: boolean,
    aWidth: number, aHeight: number, bWidth: number, bHeight: number,
  ): { a: VideoCompositeResult | null; b: VideoCompositeResult | null } | null {
    if (this.settings.get('videoRendererIn') !== 'dualRaster') return null;
    const refA = this.settings.get('videoDualRasterInA');
    const refB = this.settings.get('videoDualRasterInB');
    return {
      a: this.resolveRef(refA, texA, aActive, texB, bActive, aWidth, aHeight, bWidth, bHeight),
      b: this.resolveRef(refB, texA, aActive, texB, bActive, aWidth, aHeight, bWidth, bHeight),
    };
  }
}
