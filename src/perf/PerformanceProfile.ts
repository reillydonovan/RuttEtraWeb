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

import { PerformanceProfileId, SettingsStore } from '../state/Settings';

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
}
