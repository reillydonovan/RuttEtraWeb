/**
 * Centralized typed state for the Rutt/Etra synthesizer.
 *
 * The Settings object holds every parameter exposed to the user. Components
 * mutate it via `set(key, value)` and observe it via `subscribe(key, fn)` or
 * `subscribeAll(fn)`. All state is debounced-persisted to localStorage.
 *
 * Keys are flat (dot-free) strings so they can be used as modulation targets.
 */

export type ColorMode = 'grayscale' | 'phosphorGreen' | 'phosphorAmber' | 'phosphorCustom' | 'video';
export type RenderMode = 'scanlines' | 'dots' | 'wireframe';
export type CameraMode = 'orbit' | 'fly';
export type ModSource = 'ramp' | 'sine' | 'triangle' | 'square' | 'saw' | 'pulse' | 'audio' | 'joystickX' | 'joystickY' | 'joystickZ';

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
}

export type ModTarget =
  | 'hPos' | 'vPos' | 'hSize' | 'vSize' | 'aspect'
  | 'zPush' | 'zBias' | 'intensity' | 'focus'
  | 'hCenter' | 'vCenter' | 'hSpin' | 'vSpin'
  | 'hLinearity' | 'vLinearity' | 'skip'
  | 'threshold' | 'contrast' | 'gamma'
  | 'bloomIntensity' | 'bloomRadius'
  | 'scanlineIntensity' | 'chromaAmount' | 'feedbackDecay'
  | 'cameraFov';

export interface CameraView {
  posX: number; posY: number; posZ: number;
  targetX: number; targetY: number; targetZ: number;
  upX: number; upY: number; upZ: number;
  fov: number;
}

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
  hPos: number;          // -2..2
  vPos: number;          // -2..2
  hSize: number;         // -2..2 (negative inverts)
  vSize: number;         // -2..2 (negative inverts)
  aspect: number;        // 0.25..4
  aspectLock: boolean;   // when true, hSize and vSize stay linked

  zPush: number;         // 0..4
  zBias: number;         // -2..2
  zInvert: boolean;

  intensity: number;     // 0..2
  focus: number;         // 0..1 (0 = sharp, 1 = soft)

  hCenter: number;       // -1..1 rotation pivot X
  vCenter: number;       // -1..1 rotation pivot Y

  hReverse: boolean;     // flip across horizontal axis
  vReverse: boolean;     // flip across vertical axis
  hSpin: number;         // continuous rotation around H axis (radians)
  vSpin: number;         // continuous rotation around V axis (radians)
  hSpinRate: number;     // optional auto-spin rate
  vSpinRate: number;

  rotate90: boolean;     // Display 0/90 switch

  scanRate: number;      // number of scan lines (rows)
  cols: number;          // samples per row

  hLinearity: number;    // -1..1 bow
  vLinearity: number;    // -1..1 bow

  skip: number;          // 0..0.95 — drop fraction of lines
  threshold: number;     // 0..1 luminance key
  contrast: number;      // 0..4
  gamma: number;         // 0.2..4

  // ---------- Color & Post FX ----------
  colorMode: ColorMode;
  customTint: string;          // hex
  backgroundColor: string;     // hex

  bloomEnabled: boolean;
  bloomIntensity: number;      // 0..3
  bloomRadius: number;         // 0..2
  bloomThreshold: number;      // 0..1

  scanlineEnabled: boolean;
  scanlineIntensity: number;   // 0..1
  scanlineDensity: number;     // 100..2000

  chromaEnabled: boolean;
  chromaAmount: number;        // 0..0.02

  vignetteEnabled: boolean;
  vignetteAmount: number;      // 0..1

  feedbackEnabled: boolean;
  feedbackDecay: number;       // 0..1 (1 = no decay, 0 = instant)

  // ---------- Geometry ----------
  renderMode: RenderMode;
  thickLines: boolean;
  lineWidth: number;           // px when thickLines is on

  // ---------- Camera ----------
  cameraMode: CameraMode;
  cameraFov: number;           // 10..120
  cameraNear: number;          // 0.001..2
  cameraFar: number;           // 5..200
  autoOrbit: boolean;
  autoOrbitSpeed: number;      // rad/sec
  flySpeed: number;            // units/sec
  flyBoost: number;            // multiplier when shift held
  defaultView: CameraView;     // saved reset target

  // ---------- Modulation ----------
  modSlots: ModSlot[];

  // ---------- UI ----------
  panelDock: 'left' | 'right';
  panelCollapsed: boolean;
  hudVisible: boolean;

  // ---------- Recorder ----------
  recordIncludeMic: boolean;
  recordBitrateMbps: number;
  recordPreferredFormat: 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
  recordFps: number;
}

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
};

export const DEFAULTS: Settings = {
  sourceKind: 'none',
  deviceId: '',
  mirrorH: true,
  mirrorV: false,
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

  bloomEnabled: true,
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

  panelDock: 'right',
  panelCollapsed: false,
  hudVisible: true,

  recordIncludeMic: false,
  recordBitrateMbps: 8,
  recordPreferredFormat: 'auto',
  recordFps: 60,
};

const STORAGE_KEY = 'ruttetra.settings.v1';

type Listener<K extends keyof Settings> = (value: Settings[K], key: K) => void;
type AnyListener = (value: unknown, key: keyof Settings) => void;

export class SettingsStore {
  private state: Settings;
  private listeners = new Map<keyof Settings, Set<AnyListener>>();
  private allListeners = new Set<AnyListener>();
  private saveTimer: number | null = null;

  constructor(initial?: Partial<Settings>) {
    const persisted = SettingsStore.loadPersisted();
    this.state = mergeDeep(DEFAULTS, persisted ?? {}, initial ?? {});
  }

  /** Read-only snapshot of the entire state. */
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

  /** Bulk-update many keys at once (skips equality check). */
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

  /** Replace state entirely (used for preset load). */
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

  /** Export a JSON-serializable snapshot. */
  export(): string {
    return JSON.stringify(this.state, null, 2);
  }

  /** Import from a JSON string (preset). */
  import(json: string): void {
    const parsed = JSON.parse(json) as Partial<Settings>;
    this.replaceAll(parsed);
  }

  /** Reset everything to defaults. */
  reset(): void {
    this.replaceAll(DEFAULTS);
  }

  private notify<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const set = this.listeners.get(key);
    if (set) for (const fn of set) (fn as Listener<K>)(value, key);
    for (const fn of this.allListeners) fn(value, key);
  }

  private scheduleSave(): void {
    if (this.saveTimer != null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch {
        /* localStorage might be full or disabled — silently ignore */
      }
    }, 250);
  }

  static loadPersisted(): Partial<Settings> | null {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? (JSON.parse(s) as Partial<Settings>) : null;
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
