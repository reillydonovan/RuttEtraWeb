/**
 * Three named performance profiles that mutate the renderer + post-fx
 * pipeline + frame interval as a unit.
 *
 *   - quality:   bloom on, scanline on, chroma on, vignette on,
 *                DPR cap 2.0, render scale 1.0, target 60 fps
 *   - balanced:  bloom on but smaller RT, scanline on, chroma off,
 *                DPR cap 1.5, render scale 0.9, target 60 fps
 *   - battery:   bloom off, scanline on (cheap), chroma off, vignette off,
 *                DPR cap 1.0, render scale 0.7, target 30 fps
 *
 * `apply()` is idempotent. Settings keys it touches:
 *   bloomEnabled, chromaEnabled, vignetteEnabled (visual flags)
 * It does NOT toggle scanlineEnabled (the brief specifies scanline rows
 * stay above 720p, which our scanlineDensity slider keeps consistent).
 *
 * The profile also sets a `frameIntervalMs` and `dprCap` exposed as
 * properties for the renderer / RAF loop to consult.
 */

import { PerformanceProfileId, Settings, SettingsStore, XrPerformanceProfileId } from '../state/Settings';

export interface PerformanceProfileSnapshot {
  id: PerformanceProfileId;
  /** Maximum allowed devicePixelRatio multiplier. */
  dprCap: number;
  /** Lower bound applied to the user's render-scale slider. */
  renderScaleFloor: number;
  /** Min ms between RAF render passes. (1000/60 ≈ 16.6, 1000/30 ≈ 33.3) */
  frameIntervalMs: number;
  /** Bloom render-target divisor (1 = full, 2 = half, 4 = quarter). */
  bloomRTDivisor: number;
  /** Whether bloom is enabled by default for this profile. */
  bloom: boolean;
  /** Cheap CRT effects. */
  chroma:   boolean;
  vignette: boolean;
}

const PROFILES: Record<PerformanceProfileId, PerformanceProfileSnapshot> = {
  quality: {
    id: 'quality',
    dprCap: 2.0,
    renderScaleFloor: 0.75,
    frameIntervalMs: 1000 / 60,
    bloomRTDivisor: 1,
    bloom: true, chroma: true, vignette: true,
  },
  balanced: {
    id: 'balanced',
    dprCap: 1.5,
    renderScaleFloor: 0.6,
    frameIntervalMs: 1000 / 60,
    bloomRTDivisor: 2,
    bloom: true, chroma: false, vignette: true,
  },
  battery: {
    id: 'battery',
    dprCap: 1.0,
    renderScaleFloor: 0.5,
    frameIntervalMs: 1000 / 30,
    bloomRTDivisor: 4,
    bloom: false, chroma: false, vignette: false,
  },
};

export function getProfile(id: PerformanceProfileId): PerformanceProfileSnapshot {
  return PROFILES[id];
}

/**
 * XR profile data — the in-headset tuning knobs that the desktop
 * `PerformanceProfileSnapshot` doesn't cover. v1 skips postfx in XR
 * per the spec's Option A, so bloom / chroma / vignette flags don't
 * apply; the two knobs that matter at the three.js level are:
 *
 *   - `framebufferScale`: passed to `renderer.xr.setFramebufferScaleFactor`,
 *      controls the actual XR layer resolution. Lower = faster, blurrier.
 *   - `foveation`: passed to `renderer.xr.setFoveation` (0..1), enables
 *      fixed foveated rendering on Quest etc. Higher = more periphery
 *      blur, faster. No-op on devices that don't support it.
 *
 * The `auto` value is resolved at `XRManager.startSession` time to one
 * of the concrete IDs based on a detected-headset hint. v1 falls back
 * to `balanced` when no hint is available.
 */
export interface XrProfileSnapshot {
  id: Exclude<XrPerformanceProfileId, 'auto'>;
  framebufferScale: number;
  foveation: number;
}

const XR_PROFILES: Record<Exclude<XrPerformanceProfileId, 'auto'>, XrProfileSnapshot> = {
  quality:  { id: 'quality',  framebufferScale: 0.9, foveation: 0.0 },
  balanced: { id: 'balanced', framebufferScale: 0.8, foveation: 0.5 },
  battery:  { id: 'battery',  framebufferScale: 0.7, foveation: 1.0 },
};

export function resolveXrProfile(
  id: XrPerformanceProfileId,
  headsetHint?: 'quest2' | 'quest3' | 'pcvr' | 'unknown',
): XrProfileSnapshot {
  if (id !== 'auto') return XR_PROFILES[id];
  switch (headsetHint) {
    case 'quest2': return XR_PROFILES.battery;
    case 'quest3': return XR_PROFILES.balanced;
    case 'pcvr':   return XR_PROFILES.quality;
    default:       return XR_PROFILES.balanced;
  }
}

export interface PerformanceTargets {
  /** Mutate visual passes. */
  setBloomEnabled(on: boolean): void;
  setChromaEnabled(on: boolean): void;
  setVignetteEnabled(on: boolean): void;
  /**
   * Renderer/composer hook: receives the new pixel-ratio cap and a render
   * scale floor; the renderer applies them next resize().
   */
  setRenderQuality(snap: PerformanceProfileSnapshot): void;
}

export class PerformanceProfileManager {
  private settings: SettingsStore;
  private targets: PerformanceTargets;
  private current: PerformanceProfileSnapshot;
  /** Manual override (from FrameBudgetWatcher toast). */
  private overrideId: PerformanceProfileId | null = null;
  /**
   * XR-session bookkeeping. Set on `beginXrSession`, cleared on
   * `endXrSession`. Captures the persisted per-mode profile map at
   * session start so we can detect whether the user changed it
   * mid-session and pick the right restore behavior.
   */
  private xrStash: {
    perMode: Settings['performanceProfile'];
  } | null = null;

  constructor(settings: SettingsStore, targets: PerformanceTargets) {
    this.settings = settings;
    this.targets = targets;
    this.current = PROFILES.balanced;
  }

  /** Apply the profile for a given layout mode. */
  applyForMode(mode: 'compact' | 'standard' | 'expansive'): void {
    const id = this.overrideId ?? this.settings.get('performanceProfile')[mode];
    this.applyId(id);
  }

  /** Apply a specific profile id (used by user override / battery toast). */
  applyId(id: PerformanceProfileId): void {
    const snap = PROFILES[id];
    this.current = snap;
    this.targets.setBloomEnabled(snap.bloom && this.settings.get('bloomEnabled'));
    this.targets.setChromaEnabled(snap.chroma && this.settings.get('chromaEnabled'));
    this.targets.setVignetteEnabled(snap.vignette && this.settings.get('vignetteEnabled'));
    this.targets.setRenderQuality(snap);
  }

  /** Override active profile across all modes (memory only — not persisted). */
  setOverride(id: PerformanceProfileId | null): void {
    this.overrideId = id;
  }

  snapshot(): PerformanceProfileSnapshot { return this.current; }

  /**
   * Snapshot the current per-mode performance profile map. Called by
   * `XRManager` on session start so that `endXrSession()` can decide
   * whether the user changed the desktop profile mid-XR (in which case
   * the new choice is preserved) or not (in which case the stash is
   * re-applied for the active layout mode).
   *
   * The desktop profile is NOT mutated during the XR session — XR
   * rendering bypasses postfx in v1 and three.js controls the
   * framebuffer dims via `XRWebGLLayer`, so the desktop profile's
   * dprCap / renderScaleFloor / frameIntervalMs simply don't apply
   * while presenting. The stash exists purely for restore semantics.
   */
  beginXrSession(): void {
    const perMode = this.settings.get('performanceProfile');
    this.xrStash = { perMode: { ...perMode } };
  }

  /**
   * Resolve the XR-end restore behavior:
   *
   *   - `{ kind: 'restored' }`: the user did NOT change the desktop
   *     profile during the XR session; the stash is re-applied for
   *     the supplied layout mode (a no-op in practice, since nothing
   *     mutated, but signaled so the caller can refresh UI).
   *   - `{ kind: 'kept-user-change', newProfileId }`: the user DID
   *     change the desktop profile during XR; the new choice is kept
   *     and the caller should toast "Desktop profile kept at <id>
   *     (changed during XR session)."
   *   - `{ kind: 'no-stash' }`: defensive — `endXrSession` was called
   *     without a matching `beginXrSession`. No restore action taken.
   */
  endXrSession(layoutMode: 'compact' | 'standard' | 'expansive'): XrEndResult {
    const stash = this.xrStash;
    this.xrStash = null;
    if (!stash) return { kind: 'no-stash' };

    const nowPerMode = this.settings.get('performanceProfile');
    if (
      nowPerMode.compact   === stash.perMode.compact &&
      nowPerMode.standard  === stash.perMode.standard &&
      nowPerMode.expansive === stash.perMode.expansive
    ) {
      this.applyForMode(layoutMode);
      return { kind: 'restored' };
    }
    return {
      kind: 'kept-user-change',
      newProfileId: nowPerMode[layoutMode],
    };
  }

  /** True between `beginXrSession` and `endXrSession`. */
  get inXrSession(): boolean { return this.xrStash !== null; }
}

export type XrEndResult =
  | { kind: 'restored' }
  | { kind: 'kept-user-change'; newProfileId: PerformanceProfileId }
  | { kind: 'no-stash' };
