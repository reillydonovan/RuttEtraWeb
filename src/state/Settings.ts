/**
 * Centralized typed state for the Rutt/Etra synthesizer.
 *
 * The Settings object holds every parameter exposed to the user. Components
 * mutate it via `set(key, value)` and observe it via `subscribe(key, fn)` or
 * `subscribeAll(fn)`.
 *
 * Persistence: auto-save is OFF by default — every page refresh starts from
 * `DEFAULTS`. Explicit save/load is available via `persist()` and
 * `loadPersisted()` (intended for a future "Save Settings" UI button).
 * Saved snapshots carry a `_v` version stamp and run through
 * `migrateSettings()` at load and import time.
 *
 * Keys are flat (dot-free) strings so they can be used as modulation targets
 * and as binding destinations from MIDI / OSC.
 */

import type { GraphPatch } from '../modulation/graph/types';

export type ColorMode = 'grayscale' | 'phosphorGreen' | 'phosphorAmber' | 'phosphorCustom' | 'video';
export type ModMode = 'classic' | 'graph' | 'both';
export type RenderMode = 'scanlines' | 'dots' | 'wireframe';
export type CameraMode = 'orbit' | 'fly';
export type PerformanceProfileId = 'quality' | 'balanced' | 'battery';

export type ModSource =
  | 'ramp' | 'sine' | 'triangle' | 'square' | 'saw' | 'pulse'
  | 'audio' | 'audioBand' | 'beat'
  | 'midiCC' | 'midiNote' | 'midiVelocity' | 'midiClock'
  | 'osc'
  | 'joystickX' | 'joystickY' | 'joystickZ';

export type ClockDivision =
  | '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32'
  | '1/4.' | '1/8.' | '1/16.'      // dotted
  | '1/4T' | '1/8T' | '1/16T';     // triplet

export interface ModSlot {
  enabled: boolean;
  source: ModSource;
  target: ModTarget | 'none';
  amount: number;
  frequency: number;
  phase: number;
  duty: number;
  rampTimeSec: number;
  rampMode: 'up' | 'down' | 'triangle' | 'hold';
  rampHold: boolean;
  rampPosition: number;

  // v2 additions
  bandIndex: number;            // for 'audioBand'
  clockSync: boolean;           // override frequency with clock division
  clockDivision: ClockDivision;
  midiOutEnabled: boolean;
  midiOutChannel: number;       // 1..16
  midiOutCC: number;            // 0..127
  // For 'midiCC' / 'midiNote' / 'midiVelocity' / 'osc' sources we read whatever
  // is being captured by the binding registry. The slot itself doesn't pin a
  // channel — bindings handle that.
}

export type ModTarget =
  | 'hPos' | 'vPos' | 'hSize' | 'vSize' | 'aspect'
  | 'zPush' | 'zBias' | 'intensity' | 'focus'
  | 'hCenter' | 'vCenter' | 'hSpin' | 'vSpin'
  | 'hLinearity' | 'vLinearity' | 'skip'
  | 'threshold' | 'contrast' | 'gamma'
  | 'bloomIntensity' | 'bloomRadius'
  | 'scanlineIntensity' | 'chromaAmount' | 'feedbackDecay'
  | 'cameraFov'
  // v2: I/O-routable targets
  | 'audioGain' | 'audioFloor' | 'beatSensitivity'
  | 'spectrumAmount' | 'spectrumStride';

export interface CameraView {
  posX: number; posY: number; posZ: number;
  targetX: number; targetY: number; targetZ: number;
  upX: number; upY: number; upZ: number;
  fov: number;
}

// --------------------------------------------------------------------
// I/O bindings (MIDI + OSC)
// --------------------------------------------------------------------

export type BindingCurve = 'linear' | 'exp' | 'log' | 'inverted';

export interface MidiBinding {
  id: string;
  type: 'cc' | 'note' | 'cc14';
  channel: number;             // 0 = omni, 1..16 = specific channel
  controller: number;          // CC number, note number, or MSB CC for 14-bit
  controllerLsb?: number;      // LSB CC for 14-bit
  target: string;              // settings key (e.g. 'zPush')
  curve: BindingCurve;
  min: number;
  max: number;
  velocityScale?: number;      // for 'note' bindings
  glideMs?: number;
  noteMode?: 'last' | 'polyAvg';
}

export interface OscBinding {
  id: string;
  address: string;             // e.g. '/dcu/zpush'
  argIndex: number;            // which numeric arg of the message
  target: string;              // settings key
  curve: BindingCurve;
  min: number;
  max: number;
  // outgoing: when target changes, send a message back through bridge
  echo?: boolean;
}

// --------------------------------------------------------------------
// Audio
// --------------------------------------------------------------------

export type AudioInputKind = 'mic' | 'file' | 'tab' | 'none';
export type FftSize = 512 | 1024 | 2048 | 4096;
export type BandCount = 8 | 16 | 32 | 64 | 128;
export type BandSpacing = 'linear' | 'log' | 'mel';

export interface AudioSpectrumRouting {
  enabled: boolean;
  amount: number;              // 0..2
  stride: number;              // 0.1..4 (rows-per-band scaling)
  attackMs: number;
  releaseMs: number;
}

// --------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------

export interface Settings {
  // ---------- Source ----------
  sourceKind: 'webcam' | 'file' | 'screen' | 'none';
  deviceId: string;
  mirrorH: boolean;
  mirrorV: boolean;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: number;

  // ---------- DCU (native Rutt/Etra controls) ----------
  hPos: number;
  vPos: number;
  hSize: number;
  vSize: number;
  aspect: number;
  aspectLock: boolean;

  zPush: number;
  zBias: number;
  zInvert: boolean;

  intensity: number;
  focus: number;

  hCenter: number;
  vCenter: number;

  hReverse: boolean;
  vReverse: boolean;
  hSpin: number;
  vSpin: number;
  hSpinRate: number;
  vSpinRate: number;

  rotate90: boolean;

  scanRate: number;
  cols: number;

  hLinearity: number;
  vLinearity: number;

  skip: number;
  threshold: number;
  contrast: number;
  gamma: number;

  // ---------- Color & Post FX ----------
  colorMode: ColorMode;
  customTint: string;
  backgroundColor: string;

  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomRadius: number;
  bloomThreshold: number;

  scanlineEnabled: boolean;
  scanlineIntensity: number;
  scanlineDensity: number;

  chromaEnabled: boolean;
  chromaAmount: number;

  vignetteEnabled: boolean;
  vignetteAmount: number;

  feedbackEnabled: boolean;
  feedbackDecay: number;

  // ---------- Geometry ----------
  renderMode: RenderMode;
  thickLines: boolean;
  lineWidth: number;

  // ---------- Camera ----------
  cameraMode: CameraMode;
  cameraFov: number;
  cameraNear: number;
  cameraFar: number;
  autoOrbit: boolean;
  autoOrbitSpeed: number;
  flySpeed: number;
  flyBoost: number;
  defaultView: CameraView;

  // ---------- Modulation ----------
  modSlots: ModSlot[];
  /**
   * Active modulation engine(s). `'classic'` keeps the legacy 4-slot matrix
   * exclusive (default for fresh users + old presets); `'graph'` runs the
   * signal-graph engine instead; `'both'` runs them simultaneously and
   * sums their effects on shared targets.
   */
  modMode: ModMode;
  /**
   * Stored signal-graph patch. `null` means no patch loaded — the engine
   * is gated by `modMode` regardless. Only mutated through the engine /
   * UI; callers should never write to nodes directly.
   */
  modGraph: GraphPatch | null;

  // ---------- UI ----------
  panelDock: 'left' | 'right';
  panelCollapsed: boolean;
  panelTab: 'synth' | 'io' | 'help';
  hudVisible: boolean;

  // ---------- Help ----------
  helpSeen: boolean;
  helpAutoOpen: boolean;
  helpActiveTab: 'what' | 'quickstart' | 'controls' | 'shortcuts' | 'mod' | 'timeline' | 'tips' | 'about';

  // ---------- Timeline / Sequencer (UI-state only; timeline data lives in its own store) ----------
  timelineDock: 'top' | 'bottom' | 'hidden';
  /** Last *visible* dock position. Restored when toggling out of 'hidden'. */
  timelineLastDock: 'top' | 'bottom';
  timelineHeight: number;
  activeTimelineId: string | null;

  // ---------- Mobile / responsive layout (v4) ----------
  /** Per-mode performance profile. Persisted across sessions. */
  performanceProfile: {
    compact:   PerformanceProfileId;
    standard:  PerformanceProfileId;
    expansive: PerformanceProfileId;
  };
  /** Multiplier on DPR-adjusted resolution. 0.5..1.5; default 1.0. */
  renderScale: number;
  /** Vibrate on keyframe-reached / preset-load. Touch devices default ON. */
  hapticsEnabled: boolean;
  /** Request screen wake-lock during recording / broadcasting. */
  wakeLockOnRecord: boolean;
  /** Touch-device camera facing mode for getUserMedia. */
  cameraFacing: 'user' | 'environment';
  /** Set to true on first user gesture so audio init can proceed. */
  audioGestureUnlocked: boolean;
  /** One-shot flag: true after we've auto-applied the mobile-first
   *  default `colorMode = 'video'` on the first compact-mode boot. */
  mobileColorAutoSet: boolean;

  // ---------- Recorder ----------
  recordIncludeMic: boolean;
  recordBitrateMbps: number;
  recordPreferredFormat: 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
  recordFps: number;

  // ---------- MIDI (v2) ----------
  midiInputId: string;
  midiOutputId: string;
  midiBindings: MidiBinding[];

  // ---------- OSC (v2) ----------
  oscBridgeUrl: string;
  oscAutoConnect: boolean;
  oscBindings: OscBinding[];

  // ---------- Audio / FFT (v2) ----------
  audioInputKind: AudioInputKind;
  audioFftSize: FftSize;
  audioBandCount: BandCount;
  audioBandSpacing: BandSpacing;
  audioAttackMs: number;
  audioReleaseMs: number;
  audioGain: number;            // master gain applied to band values
  audioFloor: number;           // values below this clamp to 0
  audioThresholdDb: number;     // dB floor in the analyser
  audioMonitor: boolean;        // route audio to speakers (default OFF)
  audioSpectrum: AudioSpectrumRouting;
  beatEnabled: boolean;
  beatSensitivity: number;      // multiplier on adaptive threshold

  // Routable convenience targets (mirror audioSpectrum sub-keys for ModTarget)
  spectrumAmount: number;
  spectrumStride: number;
}

// --------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------

export const DEFAULT_VIEW: CameraView = {
  posX: 0, posY: 0.4, posZ: 2.6,
  targetX: 0, targetY: 0, targetZ: 0,
  upX: 0, upY: 1, upZ: 0,
  fov: 50,
};

export const DEFAULT_MOD_SLOT: ModSlot = {
  enabled: false,
  source: 'sine',
  target: 'none',
  amount: 0.25,
  frequency: 0.5,
  phase: 0,
  duty: 0.5,
  rampTimeSec: 4,
  rampMode: 'up',
  rampHold: false,
  rampPosition: 0,
  bandIndex: 0,
  clockSync: false,
  clockDivision: '1/4',
  midiOutEnabled: false,
  midiOutChannel: 1,
  midiOutCC: 1,
};

export const DEFAULT_SPECTRUM: AudioSpectrumRouting = {
  enabled: false,
  amount: 0.5,
  stride: 1.0,
  attackMs: 30,
  releaseMs: 200,
};

export const DEFAULTS: Settings = {
  sourceKind: 'none',
  deviceId: '',
  mirrorH: true,
  mirrorV: true,
  requestedWidth: 640,
  requestedHeight: 480,
  requestedFps: 30,

  hPos: 0, vPos: 0,
  hSize: 1, vSize: 1,
  aspect: 4 / 3,
  aspectLock: false,

  zPush: 0.9,
  zBias: 0,
  zInvert: false,

  intensity: 1.0,
  focus: 0.0,

  hCenter: 0, vCenter: 0,
  hReverse: false, vReverse: false,
  hSpin: 0, vSpin: 0,
  hSpinRate: 0, vSpinRate: 0,

  rotate90: false,

  scanRate: 240,
  cols: 320,

  hLinearity: 0,
  vLinearity: 0,

  skip: 0,
  threshold: 0.04,
  contrast: 1.0,
  gamma: 1.0,

  colorMode: 'phosphorGreen',
  customTint: '#5fff85',
  backgroundColor: '#050807',

  // Bloom OFF by default per v2 spec.
  bloomEnabled: false,
  bloomIntensity: 0.85,
  bloomRadius: 0.6,
  bloomThreshold: 0.15,

  scanlineEnabled: true,
  scanlineIntensity: 0.18,
  scanlineDensity: 720,

  chromaEnabled: true,
  chromaAmount: 0.0025,

  vignetteEnabled: true,
  vignetteAmount: 0.55,

  feedbackEnabled: false,
  feedbackDecay: 0.9,

  renderMode: 'scanlines',
  thickLines: false,
  lineWidth: 1.5,

  cameraMode: 'orbit',
  cameraFov: 50,
  cameraNear: 0.01,
  cameraFar: 100,
  autoOrbit: false,
  autoOrbitSpeed: 0.15,
  flySpeed: 1.5,
  flyBoost: 4,
  defaultView: { ...DEFAULT_VIEW },

  modSlots: [
    { ...DEFAULT_MOD_SLOT },
    { ...DEFAULT_MOD_SLOT },
    { ...DEFAULT_MOD_SLOT },
    { ...DEFAULT_MOD_SLOT },
  ],
  modMode: 'classic',
  modGraph: null,

  panelDock: 'right',
  panelCollapsed: false,
  panelTab: 'synth',
  hudVisible: true,

  helpSeen: false,
  helpAutoOpen: true,
  helpActiveTab: 'quickstart',

  timelineDock: 'hidden',
  timelineLastDock: 'bottom',
  timelineHeight: 220,
  activeTimelineId: null,

  performanceProfile: {
    compact:   'battery',
    standard:  'balanced',
    expansive: 'quality',
  },
  renderScale: 1.0,
  hapticsEnabled: true,
  wakeLockOnRecord: true,
  cameraFacing: 'user',
  audioGestureUnlocked: false,
  mobileColorAutoSet: false,

  recordIncludeMic: false,
  recordBitrateMbps: 8,
  recordPreferredFormat: 'auto',
  recordFps: 60,

  midiInputId: '',
  midiOutputId: '',
  midiBindings: [],

  oscBridgeUrl: 'ws://localhost:8080',
  oscAutoConnect: false,
  oscBindings: [],

  audioInputKind: 'none',
  audioFftSize: 2048,
  audioBandCount: 32,
  audioBandSpacing: 'log',
  audioAttackMs: 25,
  audioReleaseMs: 180,
  audioGain: 1.0,
  audioFloor: 0.02,
  audioThresholdDb: -90,
  audioMonitor: false,
  audioSpectrum: { ...DEFAULT_SPECTRUM },
  beatEnabled: false,
  beatSensitivity: 1.4,

  spectrumAmount: 0.5,
  spectrumStride: 1.0,
};

// --------------------------------------------------------------------
// Persistence + migration
// --------------------------------------------------------------------

const STORAGE_KEY = 'ruttetra.settings.v1';
const CURRENT_VERSION = 6;

interface Versioned { _v?: number }

/**
 * Forward-compatible migration. Each step is idempotent — re-running on an
 * already-migrated object produces no changes.
 */
export function migrateSettings(rawIn: unknown): Partial<Settings> & Versioned {
  if (!rawIn || typeof rawIn !== 'object') return { _v: CURRENT_VERSION };
  const raw = rawIn as Partial<Settings> & Versioned & Record<string, unknown>;
  const v = raw._v ?? 1;
  let s: Partial<Settings> & Versioned & Record<string, unknown> = { ...raw };

  // ---- v1 -> v2: I/O subsystems ----
  if (v < 2) {
    s.midiInputId   = (s.midiInputId   as string | undefined) ?? '';
    s.midiOutputId  = (s.midiOutputId  as string | undefined) ?? '';
    s.midiBindings  = (s.midiBindings  as MidiBinding[] | undefined) ?? [];
    s.oscBridgeUrl  = (s.oscBridgeUrl  as string | undefined) ?? 'ws://localhost:8080';
    s.oscAutoConnect= (s.oscAutoConnect as boolean | undefined) ?? false;
    s.oscBindings   = (s.oscBindings   as OscBinding[] | undefined) ?? [];

    s.audioInputKind   = (s.audioInputKind   as AudioInputKind | undefined) ?? 'none';
    s.audioFftSize     = (s.audioFftSize     as FftSize        | undefined) ?? 2048;
    s.audioBandCount   = (s.audioBandCount   as BandCount      | undefined) ?? 32;
    s.audioBandSpacing = (s.audioBandSpacing as BandSpacing    | undefined) ?? 'log';
    s.audioAttackMs    = (s.audioAttackMs    as number         | undefined) ?? 25;
    s.audioReleaseMs   = (s.audioReleaseMs   as number         | undefined) ?? 180;
    s.audioGain        = (s.audioGain        as number         | undefined) ?? 1.0;
    s.audioFloor       = (s.audioFloor       as number         | undefined) ?? 0.02;
    s.audioThresholdDb = (s.audioThresholdDb as number         | undefined) ?? -90;
    s.audioMonitor     = (s.audioMonitor     as boolean        | undefined) ?? false;
    s.audioSpectrum    = (s.audioSpectrum    as AudioSpectrumRouting | undefined) ?? { ...DEFAULT_SPECTRUM };
    s.beatEnabled      = (s.beatEnabled      as boolean        | undefined) ?? false;
    s.beatSensitivity  = (s.beatSensitivity  as number         | undefined) ?? 1.4;
    s.spectrumAmount   = (s.spectrumAmount   as number         | undefined) ?? 0.5;
    s.spectrumStride   = (s.spectrumStride   as number         | undefined) ?? 1.0;
    s.panelTab         = (s.panelTab         as 'synth' | 'io' | undefined) ?? 'synth';

    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as Partial<ModSlot>[]).map((slot) => ({
        ...DEFAULT_MOD_SLOT,
        ...slot,
        bandIndex:      slot.bandIndex      ?? 0,
        clockSync:      slot.clockSync      ?? false,
        clockDivision:  slot.clockDivision  ?? '1/4',
        midiOutEnabled: slot.midiOutEnabled ?? false,
        midiOutChannel: slot.midiOutChannel ?? 1,
        midiOutCC:      slot.midiOutCC      ?? 1,
      })) as ModSlot[];
    }

    s._v = 2;
  }

  // ---- v2 -> v3: Help panel + Timeline sequencer ----
  if ((s._v ?? 1) < 3) {
    s.helpSeen        = (s.helpSeen        as boolean | undefined) ?? false;
    s.helpAutoOpen    = (s.helpAutoOpen    as boolean | undefined) ?? true;
    s.helpActiveTab   = (s.helpActiveTab   as Settings['helpActiveTab'] | undefined) ?? 'quickstart';
    s.timelineDock    = (s.timelineDock    as Settings['timelineDock']  | undefined) ?? 'bottom';
    s.timelineHeight  = (s.timelineHeight  as number  | undefined) ?? 220;
    s.activeTimelineId= (s.activeTimelineId as string | null | undefined) ?? null;
    s._v = 3;
  }

  // ---- v3 -> v4: Mobile-first responsive overhaul ----
  if ((s._v ?? 1) < 4) {
    // Carry the previous visible side into `timelineLastDock`, then force
    // `timelineDock` to 'hidden' for everyone so the canvas isn't covered
    // on first load after the upgrade. The user can re-show via the mini
    // handle, which restores `timelineLastDock`.
    const prevDock = s.timelineDock as Settings['timelineDock'] | undefined;
    s.timelineLastDock = (s.timelineLastDock as Settings['timelineLastDock'] | undefined)
      ?? (prevDock === 'top' ? 'top' : 'bottom');
    s.timelineDock = 'hidden';
    s.performanceProfile = (s.performanceProfile as Settings['performanceProfile'] | undefined) ?? {
      compact:   'battery',
      standard:  'balanced',
      expansive: 'quality',
    };
    s.renderScale          = (s.renderScale          as number  | undefined) ?? 1.0;
    s.hapticsEnabled       = (s.hapticsEnabled       as boolean | undefined) ?? true;
    s.wakeLockOnRecord     = (s.wakeLockOnRecord     as boolean | undefined) ?? true;
    s.cameraFacing         = (s.cameraFacing         as Settings['cameraFacing'] | undefined) ?? 'user';
    s.audioGestureUnlocked = (s.audioGestureUnlocked as boolean | undefined) ?? false;
    s._v = 4;
  }

  // ---- v4 -> v5: Mobile color-mode auto-apply flag ----
  // We don't change colorMode here (existing users keep their picked
  // phosphor look). main.ts applies `colorMode = 'video'` once on the
  // first compact-mode boot when this flag is false, then sets it true.
  if ((s._v ?? 1) < 5) {
    s.mobileColorAutoSet = (s.mobileColorAutoSet as boolean | undefined) ?? false;
    s._v = 5;
  }

  // ---- v5 -> v6: Signal-graph modulation engine ----
  // Existing presets stay on the Classic 4-slot matrix; the new engine
  // is opt-in. `modGraph` is null until the user creates a patch (or
  // explicitly converts a Classic patch via the "Convert to Graph"
  // button in the UI).
  if ((s._v ?? 1) < 6) {
    s.modMode  = (s.modMode  as ModMode    | undefined) ?? 'classic';
    s.modGraph = (s.modGraph as GraphPatch | null | undefined) ?? null;
    s._v = 6;
  }

  return s as Partial<Settings> & Versioned;
}

// --------------------------------------------------------------------
// Store
// --------------------------------------------------------------------

type Listener<K extends keyof Settings> = (value: Settings[K], key: K) => void;
type AnyListener = (value: unknown, key: keyof Settings) => void;

export class SettingsStore {
  private state: Settings;
  private listeners = new Map<keyof Settings, Set<AnyListener>>();
  private allListeners = new Set<AnyListener>();
  private suppressAll = false;

  /**
   * Auto-persistence is OFF by default — every page refresh starts from
   * `DEFAULTS`. Explicit save/load is exposed via `persist()` and
   * `loadPersisted()` for future "Save Settings" / "Load Settings" buttons.
   * Set this to `true` to re-enable the legacy auto-save behaviour.
   */
  static autoPersist = false;
  private saveTimer: number | null = null;

  constructor(initial?: Partial<Settings>) {
    const persisted = SettingsStore.autoPersist ? SettingsStore.loadPersisted() : null;
    this.state = mergeDeep(DEFAULTS, persisted ?? {}, initial ?? {});
  }

  get all(): Readonly<Settings> {
    return this.state;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.state[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (Object.is(this.state[key], value)) return;
    this.state[key] = value;
    this.notify(key, value);
    this.scheduleSave();
  }

  patch(partial: Partial<Settings>): void {
    let changed = false;
    for (const k of Object.keys(partial) as (keyof Settings)[]) {
      const v = partial[k];
      if (v === undefined) continue;
      if (!Object.is(this.state[k], v)) {
        (this.state as any)[k] = v;
        this.notify(k, v);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  /**
   * Hot-path batch update used by the sequencer.
   *
   * Writes every changed key, fires per-key subscribers ONCE per changed key
   * (same as `patch`), but defers `subscribeAll` listeners to a single
   * trailing call with a `Set` of changed keys — and only schedules one save.
   *
   * Compared to `patch()`, this avoids `subscribeAll` callbacks firing N times
   * when the sequencer interpolates ~30 numeric params per frame.
   */
  batchUpdate(partial: Partial<Settings>): void {
    const changedKeys = new Set<keyof Settings>();
    for (const k of Object.keys(partial) as (keyof Settings)[]) {
      const v = partial[k];
      if (v === undefined) continue;
      if (!Object.is(this.state[k], v)) {
        (this.state as any)[k] = v;
        changedKeys.add(k);
      }
    }
    if (changedKeys.size === 0) return;
    // Per-key listeners run individually so each control gets a chance to
    // refresh its DOM, but we suppress subscribeAll fan-out during the burst.
    this.suppressAll = true;
    try {
      for (const k of changedKeys) this.notify(k, this.state[k]);
    } finally {
      this.suppressAll = false;
    }
    // Single trailing all-listeners call.
    for (const fn of this.allListeners) {
      // We pick the last changed key as the "representative" key; subscribers
      // typically just rebuild their state from the store, not from this arg.
      const lastKey = [...changedKeys][changedKeys.size - 1];
      fn(this.state[lastKey], lastKey);
    }
    this.scheduleSave();
  }

  replaceAll(next: Partial<Settings>): void {
    const merged = mergeDeep(DEFAULTS, next);
    for (const k of Object.keys(merged) as (keyof Settings)[]) {
      const v = merged[k];
      if (!Object.is(this.state[k], v)) {
        (this.state as any)[k] = v;
        this.notify(k, v);
      }
    }
    this.scheduleSave();
  }

  subscribe<K extends keyof Settings>(key: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn as AnyListener);
    fn(this.state[key], key);
    return () => {
      this.listeners.get(key)?.delete(fn as AnyListener);
    };
  }

  subscribeAll(fn: AnyListener): () => void {
    this.allListeners.add(fn);
    return () => this.allListeners.delete(fn);
  }

  /** Export a JSON-serializable snapshot, stamped with the current version. */
  export(): string {
    return JSON.stringify({ ...this.state, _v: CURRENT_VERSION }, null, 2);
  }

  /** Import from JSON; runs migration before merging. */
  import(json: string): void {
    const parsed = JSON.parse(json) as unknown;
    const migrated = migrateSettings(parsed);
    this.replaceAll(migrated);
  }

  reset(): void {
    this.replaceAll(DEFAULTS);
  }

  private notify<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const set = this.listeners.get(key);
    if (set) for (const fn of set) (fn as Listener<K>)(value, key);
    if (!this.suppressAll) {
      for (const fn of this.allListeners) fn(value, key);
    }
  }

  private scheduleSave(): void {
    if (!SettingsStore.autoPersist) return;
    if (this.saveTimer != null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 250);
  }

  /**
   * Explicitly serialize the current state to localStorage. Intended to be
   * called from a future "Save Settings" UI button. No-op-safe if storage
   * is full or unavailable.
   */
  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.state, _v: CURRENT_VERSION }));
    } catch {
      /* localStorage might be full or disabled — silently ignore */
    }
  }

  static loadPersisted(): Partial<Settings> | null {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (!s) return null;
      const raw = JSON.parse(s) as unknown;
      const migrated = migrateSettings(raw);
      // Strip the `_v` so it doesn't leak into typed Settings keys.
      const { _v: _ignore, ...rest } = migrated as { _v?: number } & Partial<Settings>;
      return rest;
    } catch {
      return null;
    }
  }
}

/** Shallow-deep merge: top-level keys are replaced; arrays are replaced as-is. */
function mergeDeep(...sources: Partial<Settings>[]): Settings {
  const out: any = {};
  for (const src of sources) {
    for (const k of Object.keys(src) as (keyof Settings)[]) {
      const v = src[k];
      if (v === undefined) continue;
      out[k] = v;
    }
  }
  return out as Settings;
}

/** Singleton instance for convenience. */
export const settings = new SettingsStore();
