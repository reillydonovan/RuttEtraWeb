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

/**
 * XR mesh framing presets. Picked before / during an XR session; controls
 * how big the scanline mesh appears relative to the user's body. See
 * `XRManager.applyMeshFraming` for the per-preset scale + position math.
 *
 *   - `tabletop`     ~1m × 0.6m × 0.4m, 1m in front at chest height
 *   - `roomscale`    ~3m × 2m × 1.5m, 2m ahead — user can walk through
 *   - `architectural` ~10m × 6m × 4m, large; "stand still and look"
 */
export type XrMeshScale = 'tabletop' | 'roomscale' | 'architectural';

/**
 * XR-specific performance profile. Stereo rendering at headset refresh
 * rates roughly doubles GPU cost, so this is a separate axis from the
 * desktop profile rather than reusing the same enum:
 *
 *   - `auto`     XRManager picks based on detected headset hint
 *   - `quality`  full scan rate, full postfx (when postfx-in-XR ships)
 *   - `balanced` (default) reduced scan rate, no chroma / feedback
 *   - `battery`  half scan rate, target 72Hz where supported
 */
export type XrPerformanceProfileId = 'auto' | 'quality' | 'balanced' | 'battery';
export type FitMode = 'letterbox' | 'fill' | 'stretch';

export type ModSource =
  | 'ramp' | 'sine' | 'triangle' | 'square' | 'saw' | 'pulse'
  | 'audio' | 'audioBand' | 'beat'
  | 'midiCC' | 'midiNote' | 'midiVelocity' | 'midiClock'
  | 'osc'
  | 'joystickX' | 'joystickY' | 'joystickZ'
  | 'constant'
  // v9: external voltage control (CV)
  | 'cvAudio'      // DC-coupled audio interface channel
  | 'cvOsc'        // OSC bridge (/cv/<n>)
  | 'gamepadAxis'  // Gamepad / HID axis
  | 'gamepadBtn'   // Gamepad / HID button (0/1)
  // v10: pattern internal signal bus (Lissajous X/Y, Sine Bands wave,
  // Oscilloscope mean / trigger, etc.). The slot's `patternOutputId`
  // field selects which signal — format `<patternKind>:<signalId>`.
  | 'patternOutput';

/**
 * Per-slot sync mode (replaces the legacy `clockSync: boolean`).
 *   'free'  — free-running rate from `slot.frequency`
 *   'midi'  — locked to incoming MIDI clock; holds last-known rate when no
 *             clock is being received (no silent fallback to internalBpm)
 *   'tempo' — locked to the global `Settings.internalBpm` via clock division
 */
export type SyncMode = 'free' | 'midi' | 'tempo';

/** Curve shapes applied at the per-slot output stage. */
export type OutputCurve = 'linear' | 'exp' | 'log' | 's' | 'step';

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
  /**
   * v21: coarse frequency range switch (Lo/Mid/Hi) on the LFO — a
   * multiplier on `frequency` in Free sync mode (×0.01 / ×1 / ×10),
   * like the range switch on the original hardware's oscillators.
   * 'high' above ~20 Hz enters stroboscopic territory: modulation is
   * evaluated once per frame, so the visual aliases against the frame
   * rate (true audio-rate is a separate design track — AUDIT item 1).
   */
  freqRange: 'low' | 'mid' | 'high';
  phase: number;
  duty: number;
  rampTimeSec: number;
  rampMode: 'up' | 'down' | 'triangle' | 'hold';
  rampHold: boolean;
  rampPosition: number;

  // v2 additions
  bandIndex: number;            // for 'audioBand'
  /**
   * Sync mode replaces the legacy `clockSync: boolean` (v7 → v8).
   * 'free' (def), 'midi', or 'tempo'.
   */
  syncMode: SyncMode;
  clockDivision: ClockDivision;
  midiOutEnabled: boolean;
  midiOutChannel: number;       // 1..16
  midiOutCC: number;            // 0..127
  // For 'midiCC' / 'midiNote' / 'midiVelocity' / 'osc' sources we read whatever
  // is being captured by the binding registry. The slot itself doesn't pin a
  // channel — bindings handle that.

  // ---------- v8 additions ----------
  /** LFO internal amplitude before Amount stage. 0..1, default 1. */
  lfoDepth: number;
  /** When true, LFO output is remapped from -1..1 → 0..1. */
  lfoUnipolar: boolean;

  /** Audio envelope per-slot follower params. */
  audioAttackMs: number;        // 1..1000, default 10
  audioReleaseMs: number;       // 1..5000, default 100
  audioGain: number;            // 0..4, default 1
  audioFloor: number;           // 0..1, default 0 (noise gate)

  /** Joystick post-read shaping (per slot). */
  joystickSmoothMs: number;     // 0..500, default 0
  joystickDeadzone: number;     // 0..0.5, default 0
  joystickInvert: boolean;

  /** Ramp behavior. When false, runs once and holds at end value. */
  rampLoop: boolean;            // default true

  /** Output stage — runs before `* amount` in the matrix tick. */
  outputCurve: OutputCurve;     // default 'linear'
  outputMin: number;            // default -1
  outputMax: number;            // default 1
  outputOffset: number;         // -1..1, default 0
  outputInvert: boolean;        // default false

  // ---------- v20: apply mode ----------
  /**
   * How this slot's value combines onto its target (v20):
   *   'additive'       — offset: live = (base + Σ) · Π   [the classic sum]
   *   'multiplicative' — factor: contributes (1 + value·amount) to Π —
   *                      amount 0 = no effect, matching the Graph
   *                      binding's identical mode. Rutt-faithful: this is
   *                      the "multiplier" patched between a source and a
   *                      destination input.
   * CV-out targets (`cv:N`) ignore this — the raw value is what leaves
   * the jack.
   */
  mode: 'additive' | 'multiplicative';

  // ---------- v18: per-slot slew (glide) ----------
  /**
   * Rise / fall slew on the post-output-stage value, in ms. 0 = off
   * (instant, the pre-v18 behavior). Mirrors the Graph `slew` node's
   * exponential `1 - exp(-dt/tau)` approach — same math via the shared
   * `slewToward()` helper in `modulation/outputStage.ts`.
   */
  slewRiseMs: number;           // 0..5000, default 0
  slewFallMs: number;           // 0..5000, default 0

  /** Constant source value, used only when source === 'constant'. */
  constantValue: number;        // -1..1, default 0

  // ---------- v9: CV / gamepad source params ----------
  /** Channel index for `cvAudio` (audio-interface CV) or `cvOsc` (bridge). */
  cvChannel: number;            // 0..n-1, default 0
  /** Axis or button index for gamepad sources. */
  gamepadIndex: number;         // 0..n-1, default 0

  // ---------- v10: pattern output source ----------
  /**
   * For `source === 'patternOutput'`: the pattern signal bus id to read,
   * formatted as `<patternKind>:<signalId>` (e.g. `'lissajous:x'`,
   * `'sineBands:wave'`, `'oscilloscope:mean'`). Empty string means "no
   * signal selected" — the slot returns 0 until the user picks one.
   * Available signals come from `PatternDef.outputs` in the registry.
   */
  patternOutputId: string;
}

export type ModTarget =
  | 'hPos' | 'vPos' | 'hSize' | 'vSize' | 'aspect'
  | 'zPush' | 'zBias' | 'intensity' | 'focus'
  | 'hCenter' | 'vCenter' | 'hSpin' | 'vSpin' | 'rotation'
  // v23: dual raster — raster B params + the wipe position
  | 'dualTracePos'
  | 'bHPos' | 'bVPos' | 'bHSize' | 'bVSize' | 'bZPush' | 'bZBias'
  | 'bIntensity' | 'bHCenter' | 'bVCenter' | 'bHSpin' | 'bVSpin'
  | 'bRotation' | 'bHLinearity' | 'bVLinearity'
  | 'bThreshold' | 'bContrast' | 'bGamma'
  | 'hLinearity' | 'vLinearity' | 'skip'
  | 'threshold' | 'contrast' | 'gamma'
  | 'bloomIntensity' | 'bloomRadius'
  | 'scanlineIntensity' | 'chromaAmount' | 'feedbackDecay'
  // v24: shape-masked feedback + analog character
  | 'feedbackShapeX' | 'feedbackShapeY' | 'feedbackShapeRadius' | 'feedbackShapeSoftness'
  | 'analogNoise' | 'analogDropout' | 'analogHum'
  | 'cameraFov'
  // v2: I/O-routable targets
  | 'audioGain' | 'audioFloor' | 'beatSensitivity'
  | 'spectrumAmount' | 'spectrumStride'
  // v9: CV-output targets, encoded as 'cv:<channelIndex>'. The list is
  // open-ended (we don't enumerate the type of every channel index)
  // because the user picks how many output channels they have. The
  // dropdown builder appends one entry per `Settings.cvOutputChannels`.
  | `cv:${number}`
  // v10: Pattern Generator modulatable params. Every numeric pattern
  // uniform that has user-musical meaning is a first-class mod target so
  // an LFO can sweep frequency, an audio envelope can pulse contrast, a
  // video-motion node can shake noise scale, etc. Non-modulatable enums
  // (kind, blend mode, axis, scope source kind/ref) are NOT here — those
  // are categorical and don't sum sensibly.
  | 'patternMix'
  | 'patternBrightness' | 'patternContrast'
  | 'patternFrequency'  | 'patternPhase'
  | 'patternScale'      | 'patternThickness'
  | 'patternDensity'
  | 'patternFreqRatio'  | 'patternPhaseOffset'
  | 'patternArms'       | 'patternOctaves'
  | 'patternPointDensity'
  | 'patternScopeSweep' | 'patternScopeTrigger'
  | 'patternScopePersist' | 'patternScopeThickness';

// --------------------------------------------------------------------
// v10: Pattern Generator
// --------------------------------------------------------------------

/**
 * Built-in synthesized "video signal" generators. Each one is a fragment
 * shader rendering to an offscreen `WebGLRenderTarget`; the result feeds
 * the DCU's `uVideo` uniform exactly the way a webcam frame does, so
 * every existing control / modulation / effect works on synthesized
 * input identically to camera input.
 *
 * Grouped into four families in the UI dropdown:
 *   - Calibration: solid, gradient, bars, grid, checker
 *   - Waveform:    sineBands, triangleBands, sawBands, squareBands,
 *                  pulseBands, lissajous, spiral
 *   - Noise:       whiteNoise, perlinNoise, worleyNoise
 *   - Oscilloscope: oscilloscope (renders an arbitrary signal as a
 *                  scope trace — most Rutt-faithful generator)
 */
export type PatternKind =
  | 'solid' | 'gradient' | 'bars' | 'grid' | 'checker'
  | 'sineBands' | 'triangleBands' | 'sawBands' | 'squareBands' | 'pulseBands'
  | 'lissajous' | 'spiral'
  | 'whiteNoise' | 'perlinNoise' | 'worleyNoise'
  | 'oscilloscope';

/** Compositor blend modes between the pattern texture and the video
 *  texture. Selected per-frame via a uniform int in the compositor
 *  fragment shader. */
export type PatternBlendMode =
  | 'replace' | 'add' | 'subtract' | 'multiply'
  | 'screen' | 'difference' | 'mask' | 'crossfade';

/** Axis enum used by every "bands" pattern (and a few others). */
export type PatternAxis = 'h' | 'v' | 'both' | 'radial';

/** Linear gradient direction vs. radial falloff. */
export type PatternGradientShape = 'linear' | 'radial';

/** Where the oscilloscope trace gets its samples from. */
export type PatternScopeSourceKind =
  | 'audio'           // audio analyser time-domain (live mic / file / tab)
  | 'classic-slot'    // ref = 1-based slot index ('1'..'4')
  | 'graph-node'      // ref = '<nodeId>:<port>' (e.g. 'lfo-1:out')
  | 'settings-param'  // ref = a Settings key (e.g. 'zPush'); reads live.getLive
  | 'beat';           // beat-detector pulses (1.0 on hit, decay)

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
// CV (external voltage control) — v9
// --------------------------------------------------------------------

/** Eurorack ±5V is the most common; widen for industrial / Buchla rigs. */
export type CVRange = '+/-5V' | '0-5V' | '+/-10V' | '0-10V';

/** Bipolar emits -1..1 (knob centered at 0V); Unipolar emits 0..1 (rest at min). */
export type CVPolarity = 'bipolar' | 'unipolar';

/** Sample rate the channel is read at. Audio rate is the AudioContext sample
 *  rate (48k typical) — only useful for FM-style audio-rate modulation; control
 *  rate buckets the worklet samples to a fixed Hz to save CPU on slow CVs. */
export type CVControlRate = 100 | 1000 | 48000;

export interface CVChannel {
  enabled: boolean;
  /** Free-form label so the user can write "Maths Ch1 Output" or "Pitch CV". */
  label: string;
  range: CVRange;
  polarity: CVPolarity;
  /** 1-pole lowpass time constant. 0 = none, up to 500ms. */
  smoothMs: number;
  controlRate: CVControlRate;
  /**
   * Calibration zero. Stored as raw audio sample (-1..1). Subtracted from
   * incoming samples before mapping to volts/normalized output. Captured
   * via the "Calibrate" button — useful when the source has DC bias.
   */
  offset: number;
  invert: boolean;
}

export const DEFAULT_CV_CHANNEL: CVChannel = {
  enabled: false,
  label: '',
  range: '+/-5V',
  polarity: 'bipolar',
  smoothMs: 5,
  controlRate: 1000,
  offset: 0,
  invert: false,
};

// --------------------------------------------------------------------
// CV output (v9) — symmetric counterpart to CV input
// --------------------------------------------------------------------

/** Output type. Determines how the source value is interpreted before
 *  becoming a voltage on the wire. */
export type CVOutType = 'cv' | 'gate' | 'trigger' | 'clock' | 'pitch';

/** What drives the channel. The value is resolved per-frame in `CVOutput.tick`. */
export type CVOutSourceKind =
  | 'classic-slot'     // post-output-stage value of a Classic ModSlot (0..3)
  | 'graph-node'       // value of a graph node's output port
  | 'settings-param'   // current `live` value of a Settings key (via LiveValuesStore)
  | 'midi-note'        // last MIDI note (used by `pitch` type)
  | 'auto'             // type-dependent: clock=internal BPM, others=zero
  | 'constant'         // fixed value (used by Test mode + manual offsets)
  // v10: pattern internal signal published to the modulation system.
  // The channel reads `<patternKind>:<signalId>` from the signal bus
  // and emits it as voltage exactly like any other CV source.
  | 'pattern-output';

export type CVOutScaleType = 'chromatic' | 'major' | 'minor' | 'harmonic-minor' | 'pentatonic-major' | 'pentatonic-minor';

export interface CVOutputChannel {
  id: string;
  /** 0-based output channel on the configured interface. */
  channelIndex: number;
  /** Free-form user label ("Pitch CV", "Filter Env", etc.). */
  label: string;
  /** Master enable. ALWAYS forced to `false` at page load (see migration). */
  enabled: boolean;
  type: CVOutType;
  /** Voltage span at full sample scale. ±5V Eurorack default. */
  voltageRange: CVRange;
  polarity: CVPolarity;
  /** Multiplier on source value before voltage mapping. */
  scale: number;
  /** DC offset added after scale, in volts. */
  offset: number;
  /** 1-pole smoothing on the output sample. 0 = none (default for CV out). */
  smoothMs: number;

  // ---------- Source binding ----------
  sourceKind: CVOutSourceKind;
  /** For 'settings-param' — Settings key (e.g. 'zPush'). */
  sourceParam?: string;
  /** For 'classic-slot' — slot index 0..3. */
  sourceSlotIndex?: number;
  /** For 'graph-node' — node id in the active GraphPatch. */
  sourceNodeId?: string;
  /** For 'graph-node' — output port name (default 'out'). */
  sourceNodePort?: string;
  /** For 'constant' — fixed normalized value (-1..1). */
  sourceConstant?: number;
  /** For 'pattern-output' — bus id `<patternKind>:<signalId>`,
   *  e.g. `'lissajous:x'`. Empty = "no signal" (channel emits 0). */
  sourcePatternOutputId?: string;

  // ---------- gate ----------
  gateThreshold?: number;   // 0..1, default 0.5
  gateHighV?: number;       // default 5
  gateLowV?: number;        // default 0

  // ---------- trigger ----------
  triggerMs?: number;       // default 10
  triggerV?: number;        // default 5
  triggerThreshold?: number; // 0..1, default 0.1 (rising-edge detect)

  // ---------- clock ----------
  clockSource?: 'internal' | 'midi';
  clockDivision?: ClockDivision;
  clockPulsePct?: number;   // 0..1, default 0.5
  clockAmpV?: number;       // default 5

  // ---------- pitch ----------
  pitchReferenceNote?: number;     // MIDI note that maps to referenceVoltage; default 60 (C4)
  pitchReferenceVoltage?: number;  // volts at referenceNote; default 0
  pitchVoltsPerOctave?: number;    // default 1.0
  pitchGlideMs?: number;           // default 0
  pitchQuantize?: boolean;         // default true
  pitchScale?: CVOutScaleType;     // default 'chromatic'
  pitchScaleRoot?: number;         // 0..11, default 0 (C)
  /** Calibration multiplier learned during calibration. 1.0 = factory. */
  pitchCalibrationScale?: number;
  /** Set by Calibrate UI: temporarily emit a fixed reference note for tuning. */
  pitchCalibrationActiveNote?: number | null;
}

export const DEFAULT_CV_OUTPUT_CHANNEL: CVOutputChannel = {
  id: '',
  channelIndex: 0,
  label: '',
  enabled: false,
  type: 'cv',
  voltageRange: '+/-5V',
  polarity: 'bipolar',
  scale: 1,
  offset: 0,
  smoothMs: 0,
  sourceKind: 'constant',
  sourceConstant: 0,

  gateThreshold: 0.5,
  gateHighV: 5,
  gateLowV: 0,

  triggerMs: 10,
  triggerV: 5,
  triggerThreshold: 0.1,

  clockSource: 'internal',
  clockDivision: '1/16',
  clockPulsePct: 0.5,
  clockAmpV: 5,

  pitchReferenceNote: 60,
  pitchReferenceVoltage: 0,
  pitchVoltsPerOctave: 1,
  pitchGlideMs: 0,
  pitchQuantize: true,
  pitchScale: 'chromatic',
  pitchScaleRoot: 0,
  pitchCalibrationScale: 1,
  pitchCalibrationActiveNote: null,
};

/** Bridge channel for OSC-routed CV (Route C). Mirrors `/cv/<n>` addresses. */
export interface CVBridgeChannel {
  enabled: boolean;
  label: string;
  /** OSC address like '/cv/1'. Last numeric arg is read. */
  address: string;
  /** Maps incoming arg range to -1..1 (or 0..1 if unipolar). */
  inMin: number;
  inMax: number;
  polarity: CVPolarity;
  smoothMs: number;
  invert: boolean;
}

export const DEFAULT_CV_BRIDGE_CHANNEL: CVBridgeChannel = {
  enabled: false,
  label: '',
  address: '/cv/1',
  inMin: -5,
  inMax: 5,
  polarity: 'bipolar',
  smoothMs: 5,
  invert: false,
};

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
// Sonification (v10) — audible output voice driven by mesh statistics
// --------------------------------------------------------------------

/** Statistical scalars the MeshAnalyzer publishes each frame. UI mapping
 *  rows enumerate this union; new entries propagate through the help
 *  catalog automatically. */
export type MeshStatId =
  | 'meanBrightness'
  | 'brightnessVariance'
  | 'verticalCentroid'
  | 'horizontalCentroid'
  | 'meshActivity'
  | 'peakRow'
  | 'peakBrightness'
  | 'edgeDensity';

/** Voice parameters the mapping layer can drive. Single-voice scope —
 *  no LFOs, no envelopes, just these four scalars. */
export type SonificationParam = 'pitch' | 'amplitude' | 'cutoff' | 'resonance';

/** Easing applied to the 0..1 stat before mapping to the param's range.
 *  'exponential' is musical for pitch (logarithmic perception). */
export type MappingCurve = 'linear' | 'exponential' | 'logarithmic' | 'sCurve';

export type SonificationWaveform = 'sine' | 'triangle' | 'saw' | 'square';
export type SonificationFilterType = 'lowpass' | 'bandpass' | 'highpass' | 'notch';

export interface SonificationMapping {
  /** Mesh stat id; empty string = unmapped (param holds at midpoint). */
  source: MeshStatId | '';
  curve: MappingCurve;
}

export interface SonificationConfig {
  /** Master toggle. ALWAYS forced to `false` on page load / preset
   *  import. Soft-start ramp on enable. */
  enabled: boolean;
  /** Master output level in dB. Default -18 dB so first-enables are
   *  quiet by design. -inf treated as muted (set internally during
   *  Mute Briefly / mic-feedback gating). */
  masterVolumeDb: number;
  /** Oscillator waveform. */
  waveform: SonificationWaveform;
  /** Biquad filter type. Default lowpass. */
  filterType: SonificationFilterType;
  /** Pitch range as [low, high] MIDI note numbers. Default C2..C6. */
  pitchRangeMidi: [number, number];
  /** When true, pitch snaps to integer MIDI semitones. Off = continuous
   *  glide (theremin behavior). */
  quantize: boolean;
  /** 1-pole lowpass smoothing applied to every stat→param mapping, in
   *  ms. Default 40 ms. */
  smoothingMs: number;
  /** Mesh stat → voice param mappings. */
  mappings: Record<SonificationParam, SonificationMapping>;
}

export const DEFAULT_SONIFICATION: SonificationConfig = {
  enabled: false,
  masterVolumeDb: -18,
  waveform: 'sine',
  filterType: 'lowpass',
  pitchRangeMidi: [36, 84], // C2..C6
  quantize: true,
  smoothingMs: 40,
  mappings: {
    pitch:     { source: 'verticalCentroid',   curve: 'exponential' },
    amplitude: { source: 'meanBrightness',     curve: 'linear' },
    cutoff:    { source: 'brightnessVariance', curve: 'exponential' },
    resonance: { source: 'meshActivity',       curve: 'linear' },
  },
};

// --------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------

export interface Settings {
  // ---------- Source ----------
  sourceKind: 'webcam' | 'file' | 'screen' | 'stream' | 'none';
  deviceId: string;
  mirrorH: boolean;
  mirrorV: boolean;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: number;
  /**
   * Last URL used with "Use Stream". Persisted so the user doesn't need
   * to re-paste the address every session. The source does NOT auto-reconnect
   * on load — the URL is just remembered for convenience. Explicit user
   * action is required to start any source (Principle 4 applied to video:
   * the synth does not grab external resources by surprise).
   */
  streamUrl: string;
  /**
   * WHIP endpoint URL for canvas output streaming. Empty = not configured.
   * The synth sends an SDP offer to this URL (POST) and receives an SDP
   * answer. The WHIP server (OBS, MediaMTX, Cloudflare Stream, LiveKit)
   * re-distributes as HLS, RTMP, or WebRTC from its side.
   * Not auto-connected on load — explicit "Start WHIP" required.
   */
  whipEndpoint: string;
  /**
   * Optional Bearer token for authenticated WHIP servers (Cloudflare
   * Stream, LiveKit Cloud, etc.). Empty = no Authorization header sent.
   * Stored in settings so the user doesn't have to re-paste it each
   * session; treat this value as a secret you don't share in exports.
   */
  whipBearerToken: string;

  /**
   * Play the audio track of the active video file / stream source through
   * the system speakers. Disabled by default — see Principle 4 (no
   * accidental sound). Only meaningful for `sourceKind` 'file' or 'stream';
   * webcam/screen audio is handled by the Audio section.
   */
  videoAudioEnabled: boolean;
  /** Output volume for the video audio track. 0.0 – 1.0. */
  videoAudioVolume: number;

  // ---------- Pattern Generator (v10) ----------
  // A synthesized video-signal layer that runs PARALLEL to the video
  // source (webcam / file / screen). Toggle `patternEnabled` to flip
  // the layer on; `patternBlendMode` + `patternMix` describe how it
  // combines with whatever `sourceKind` is currently producing. Every
  // numeric pattern param is modulatable via the standard ModMatrix /
  // GraphEngine pipeline (see ModTarget union above).
  patternEnabled: boolean;
  patternKind: PatternKind;
  patternBlendMode: PatternBlendMode;
  patternMix: number;            // 0..1, modulatable — composites pattern over video
  // Common modulatable params (each pattern shader picks the ones it
  // needs; unused values are ignored). Defaults are pattern-specific
  // and reset on `patternKind` change via PATTERN_REGISTRY.defaults.
  patternBrightness: number;     // 0..1
  patternContrast: number;       // 0..2
  patternFrequency: number;      // cycles per frame, 0..64
  patternPhase: number;          // radians, 0..2π
  patternScale: number;          // 0.05..16 — used by noise / spiral / grid
  patternThickness: number;      // 0..1 — bars / grid / lissajous line width
  patternDensity: number;        // 0..32 — checker count / point density
  patternFreqRatio: number;      // 0.1..16 — Lissajous Y/X frequency ratio
  patternPhaseOffset: number;    // radians, 0..2π — Lissajous Y vs X
  patternArms: number;           // 1..16 — spiral arms
  patternOctaves: number;        // 1..6 — Perlin octaves
  patternPointDensity: number;   // 0.5..32 — Worley feature points
  // Non-modulatable enums.
  patternAxis: PatternAxis;
  patternGradientShape: PatternGradientShape;
  // Oscilloscope-specific.
  patternScopeSourceKind: PatternScopeSourceKind;
  patternScopeSourceRef: string;  // shape depends on sourceKind (see PatternScopeSourceKind doc)
  patternScopeSweep: number;      // 0.1..4 — how many buffer windows fit on screen (sweep speed)
  patternScopeTrigger: number;    // -1..1 rising-edge threshold; 0 disables triggering
  patternScopePersist: number;    // 0..0.99 frame-blend ("phosphor decay"); 0 = no trail
  patternScopeThickness: number;  // 0.5..8 — pixels of trace half-width
  patternScopeBeamHue: number;    // 0..1 — HSV hue of the trace; sat=1, val=brightness

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
  /**
   * v21: continuous in-plane rotation of the raster in DEGREES, composed
   * after the 0/90 switch, pivoting on H/V Center. Modulatable — the
   * shader reads the live value (converted to radians).
   */
  rotation: number;

  // ---------- v23: dual raster ----------
  /**
   * Feature flag (default OFF): render a second, independently modulated
   * raster (B) from the same video signal. When off, the singleton path
   * is completely untouched (mesh B invisible, shader mask bypassed).
   */
  dualRasterEnabled: boolean;
  /** 'wipe' = dual-trace slider splits the frame; 'alternate' = row interleave. */
  dualMode: 'wipe' | 'alternate';
  /** Wipe split 0..1: 0 = all A, 1 = all B; B grows from the top. Modulatable. */
  dualTracePos: number;
  /** Raster B deflection + luminance params (share scan/source/color with A). */
  bHPos: number; bVPos: number;
  bHSize: number; bVSize: number;
  bZPush: number; bZBias: number;
  bIntensity: number;
  bHCenter: number; bVCenter: number;
  bHSpin: number; bVSpin: number;
  bRotation: number;
  bHLinearity: number; bVLinearity: number;
  bThreshold: number; bContrast: number; bGamma: number;

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
  // ---------- v24: shape-masked feedback ----------
  /** 'full' = classic whole-frame trails; 'circle'/'box' confine trails
   *  to a movable region (center/radius/softness all modulatable). */
  feedbackShape: 'full' | 'circle' | 'box';
  feedbackShapeX: number;        // 0..1 UV center
  feedbackShapeY: number;        // 0..1 UV center
  feedbackShapeRadius: number;   // 0..1
  feedbackShapeSoftness: number; // 0..0.5 feather

  // ---------- v24: analog character ----------
  /** Wear layer: video grain, dropout lines, rolling hum bar. */
  analogEnabled: boolean;
  analogNoise: number;    // 0..1 grain amount
  analogDropout: number;  // 0..1 dropout-line probability scaler
  analogHum: number;      // 0..1 hum-bar depth

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

  // ---------- Render resolution ----------
  /**
   * Active resolution preset ID. `'match'` (default) tracks the canvas
   * display size. Any other ID fixes the GPU render target at a specific
   * pixel count, independent of window size.
   */
  renderResolutionId: string;
  /** How to display the render target when its aspect differs from the window. */
  renderFitMode: FitMode;
  /** Custom width (pixels) — only used when `renderResolutionId === 'custom'`. */
  renderResolutionCustomW: number;
  /** Custom height (pixels) — only used when `renderResolutionId === 'custom'`. */
  renderResolutionCustomH: number;

  // ---------- Modulation ----------
  /**
   * Single shared internal BPM, consumed by:
   *   - Classic LFO patches in Tempo sync mode
   *   - The Timeline sequencer (replaces the legacy per-timeline `bpm`)
   *   - The Graph `clock` node when source === 'internal'
   * MIDI Clock-derived BPM is owned by `MidiClock` and read separately by
   * any consumer in MIDI sync mode; it does NOT write here.
   */
  internalBpm: number;

  /**
   * Per-slot UI expand state. UI-only; excluded from preset export.
   * Length matches `modSlots`.
   */
  modSlotExpanded: boolean[];

  /**
   * v19: per-parameter slider range overrides, keyed by Settings key.
   * Affects the UI control's dialable range only — live values remain
   * unclamped (modulation can already exceed slider bounds). Overrides
   * are normalized through `clampRangeOverride()` before storage.
   */
  paramRangeOverrides: Record<string, { min: number; max: number }>;

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
  /** v27: width of the side control panel (drag its inner edge; clamped 280–600). */
  panelWidth: number;
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
  /** v26: width of the dock's right-hand inspector column (drag its left edge; clamped 180–420). */
  timelineInspectorWidth: number;
  activeTimelineId: string | null;
  /** v28: transport counter DISPLAY format. Bars/Beats is the timeline's
   *  only real clock (this.internalBpm × Timeline.beatsPerBar) — the
   *  other three are pure reformattings of the current playhead
   *  position for editors who think in video/audio terms. Nothing
   *  about playback or authoring changes when this changes. */
  timelineReadoutFormat: 'bars' | 'timecode' | 'frames' | 'samples';
  /** v28: frame rate used to render Timecode / Frames display. A
   *  notational reference only (like the ruler's bar/beat grid) — not
   *  tied to the recorder's capture rate (`recordFps`), which governs
   *  actual MediaRecorder output and has a different, continuous range. */
  timelineReadoutFps: number;
  /** v28: sample rate used to render Samples display. Notational only —
   *  not the AudioContext's actual hardware rate. */
  timelineReadoutSampleRate: number;

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
  /**
   * Bake the video file / stream's own audio track into the recording.
   * Independent of `videoAudioEnabled` (speaker playback) — you can
   * include audio in the recording without hearing it through speakers,
   * and vice versa. Default false; always cleared on page load alongside
   * `recordIncludeMic` so no audio captures start unexpectedly.
   */
  recordIncludeVideoAudio: boolean;
  recordBitrateMbps: number;
  recordPreferredFormat: 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
  recordFps: number;

  // ---------- MIDI (v2) ----------
  midiInputId: string;
  midiOutputId: string;
  /**
   * v22: transmit 24-PPQ MIDI clock (0xF8) from `internalBpm` on the
   * selected output. Forced OFF on every load — outward-facing signals
   * never auto-arm from a saved file (same posture as CV output).
   */
  midiClockOutEnabled: boolean;
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

  // ---------- CV (v9) ----------
  /** Master enable for the audio-interface CV reader. */
  cvEnabled: boolean;
  /** mediaDevices ID of the DC-coupled interface used as CV input. */
  cvDeviceId: string;
  /** Number of channels we requested; the worklet may end up with fewer
   *  on a browser/interface that limits us. The actual count from the
   *  running stream is held by the CVInput class, not in Settings. */
  cvRequestedChannels: number;
  /** Per-channel config. Length grows as channels are detected. */
  cvChannels: CVChannel[];

  /** OSC bridge CV channels (Route C) — read from `/cv/<n>` messages. */
  cvBridgeChannels: CVBridgeChannel[];

  /** Selected gamepad index from `navigator.getGamepads()`, or -1 = none. */
  gamepadIndex: number;
  /** Deadzone applied to gamepad axes before they're exposed as sources. */
  gamepadDeadzone: number;

  // ---------- CV output (v9) ----------
  /** Master enable for the output AudioContext. Toggling this off
   *  immediately ramps every channel to 0V then suspends the context. */
  cvOutputEnabled: boolean;
  /** mediaDevices ID of the DC-coupled output interface (used as `sinkId`). */
  cvOutputDeviceId: string;
  /** Total channel count to open on the merger. Should equal the
   *  interface's exposed output channel count. */
  cvOutputChannelCount: number;
  /** Per-channel CV-output configuration. Persisted; channels
   *  always reload with `enabled=false` for safety (see migration). */
  cvOutputChannels: CVOutputChannel[];

  // ---------- Sonification (v10) ----------
  /**
   * Master enable for the audible-output voice that turns scanline
   * mesh statistics into sound (faithful to Steina Vasulka / Bill
   * Hearn's 1970s practice of "hearing the image"). ALWAYS forced
   * to `false` on page load and preset import — see migration. The
   * user must explicitly re-enable through the Sonification UI.
   */
  sonification: SonificationConfig;

  // ---------- Stereoscopic recording (v12) ----------
  /**
   * Master enable for the side-by-side stereoscopic recording mode.
   * When true, `CanvasRecorder.start()` sources its video track from
   * `StereoCompositor`'s offscreen canvas (two camera renders per
   * frame, side-by-side composite) instead of the main display
   * canvas, and pipes the resulting MP4 blob through the SV3D
   * metadata injector before download.
   *
   * Persists across sessions — it's a recording configuration choice,
   * not runtime state. Recording itself still requires the Start
   * button per frame; this toggle just chooses which pipeline runs
   * when the user does start.
   */
  stereoRecordingEnabled: boolean;
  /**
   * Interpupillary distance in centimeters. 6.3 is the average human
   * IPD; smaller produces a subtler stereo effect (more comfortable
   * for some viewers), larger exaggerates the depth. Converted to
   * world units at recording start using a reference of 1m mesh
   * width — see `StereoCompositor.computeWorldIpd` for the scaling.
   */
  stereoIpdCm: number;
  /**
   * Whether to inject the YouTube-compatible SV3D box into MP4
   * recordings on stop. Defaults true: the user gets a YouTube-ready
   * file out of the box. Toggle off to keep the raw side-by-side
   * file when editing externally / uploading to non-YouTube targets.
   *
   * Only applies when the recording container is MP4; WebM
   * recordings have no equivalent metadata format and the toggle
   * is a no-op there (the file is still side-by-side stereo, just
   * not auto-detectable on YouTube).
   */
  stereoInjectMetadata: boolean;
  /**
   * Stereoscopic frame layout. Side-by-side is the v1 format and
   * the only value the type currently allows; the union is open
   * so future top-bottom / anaglyph stages can extend it without
   * a schema migration.
   */
  stereoFormat: 'side-by-side';

  // ---------- Anaglyph (v16) ----------
  /**
   * Render the main view in red-cyan anaglyph mode. When true the
   * EffectComposer postfx pipeline is bypassed (same constraint as XR).
   * The output lands on the main canvas, so recording, WHIP streaming,
   * and canvas capture all pick up the anaglyph image automatically.
   * View with standard red-cyan glasses.
   */
  anaglyphEnabled: boolean;
  /**
   * Eye separation for anaglyph rendering, in centimetres. Independent
   * of `stereoIpdCm` (the recording IPD) so the two can be tuned
   * separately. Mapped to Three.js StereoCamera.eyeSep (metres) at
   * render time. Default 6.4 cm = standard human IPD.
   */
  anaglyphIpdCm: number;

  // ---------- WebXR (v11) ----------
  /**
   * Mesh framing preset used at XR session start. The user picks this
   * before clicking Enter VR / Enter AR; it can also be changed mid-
   * session to re-frame on the fly. Default `tabletop` keeps the mesh
   * around the size of a desk model, comfortable for seated use.
   *
   * The active XR session mode itself (`'immersive-vr' | 'immersive-ar' |
   * null`) is NOT a Settings field — it's runtime state owned by
   * `XRManager` and read via `xrManager.sessionMode`. Putting session
   * state in Settings would serialize it into projects and require a
   * structural force-null on load; keeping it on the manager matches
   * the data model to its actual lifetime.
   */
  xrMeshScale: XrMeshScale;
  /**
   * End the XR session automatically when the browser tab becomes
   * hidden (visibilitychange → document.hidden true). Default true.
   *
   * Wired to the `visibilitychange` event, NOT to `blur` — alt-tabbing
   * to a different desktop window typically leaves the tab visible
   * (Quest Link continues to render), and the documented workflow is
   * to reach over to the desktop keyboard while wearing the headset.
   * Killing the session on every alt-tab would break that workflow;
   * killing it on tab-hidden / minimize is the right safety net.
   */
  xrAutoEndOnVisibilityChange: boolean;
  /**
   * XR-only performance profile, separate from the per-layout-mode
   * desktop `performanceProfile`. Stash-and-restore: `XRManager`
   * saves the active desktop profile on session start, applies this
   * profile while presenting, and restores the saved desktop profile
   * on session end — unless the user changed the desktop profile
   * mid-session, in which case their newer choice is kept and the
   * change is surfaced via a toast.
   */
  xrPerformanceProfile: XrPerformanceProfileId;
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
  freqRange: 'mid',
  phase: 0,
  duty: 0.5,
  rampTimeSec: 4,
  rampMode: 'up',
  rampHold: false,
  rampPosition: 0,
  bandIndex: 0,
  syncMode: 'free',
  clockDivision: '1/4',
  midiOutEnabled: false,
  midiOutChannel: 1,
  midiOutCC: 1,

  lfoDepth: 1,
  lfoUnipolar: false,

  audioAttackMs: 10,
  audioReleaseMs: 100,
  audioGain: 1,
  audioFloor: 0,

  joystickSmoothMs: 0,
  joystickDeadzone: 0,
  joystickInvert: false,

  rampLoop: true,

  outputCurve: 'linear',
  outputMin: -1,
  outputMax: 1,
  outputOffset: 0,
  outputInvert: false,

  mode: 'additive',

  slewRiseMs: 0,
  slewFallMs: 0,

  constantValue: 0,

  cvChannel: 0,
  gamepadIndex: 0,

  patternOutputId: '',
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
  streamUrl: '',
  whipEndpoint: '',
  whipBearerToken: '',
  videoAudioEnabled: false,
  videoAudioVolume: 1.0,

  // Pattern Generator (v10) — defaults to OFF, sineBands selected so a
  // user enabling it for the first time sees the most musically useful
  // pattern. Per-pattern numeric defaults below are the "common ground"
  // values; `PATTERN_REGISTRY[kind].defaults` patches them on kind switch.
  patternEnabled: false,
  patternKind: 'sineBands',
  patternBlendMode: 'replace',
  patternMix: 1.0,
  patternBrightness: 0.8,
  patternContrast: 1.0,
  patternFrequency: 8.0,
  patternPhase: 0,
  patternScale: 1.0,
  patternThickness: 0.1,
  patternDensity: 8,
  patternFreqRatio: 1.0,
  patternPhaseOffset: 0,
  patternArms: 4,
  patternOctaves: 4,
  patternPointDensity: 8,
  patternAxis: 'h',
  patternGradientShape: 'linear',
  patternScopeSourceKind: 'audio',
  patternScopeSourceRef: '',
  patternScopeSweep: 1.0,
  patternScopeTrigger: 0,
  patternScopePersist: 0.5,
  patternScopeThickness: 1.5,
  patternScopeBeamHue: 0.33,    // phosphor green

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
  rotation: 0,

  dualRasterEnabled: false,
  dualMode: 'wipe',
  dualTracePos: 0,
  bHPos: 0, bVPos: 0,
  bHSize: 1, bVSize: 1,
  bZPush: 0.9, bZBias: 0,
  bIntensity: 1,
  bHCenter: 0, bVCenter: 0,
  bHSpin: 0, bVSpin: 0,
  bRotation: 0,
  bHLinearity: 0, bVLinearity: 0,
  bThreshold: 0.04, bContrast: 1, bGamma: 1,

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
  feedbackShape: 'full',
  feedbackShapeX: 0.5,
  feedbackShapeY: 0.5,
  feedbackShapeRadius: 0.35,
  feedbackShapeSoftness: 0.1,
  analogEnabled: false,
  analogNoise: 0.15,
  analogDropout: 0.1,
  analogHum: 0.1,

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

  renderResolutionId: 'match',
  renderFitMode: 'letterbox',
  renderResolutionCustomW: 1920,
  renderResolutionCustomH: 1080,

  internalBpm: 120,
  modSlotExpanded: [false, false, false, false],
  paramRangeOverrides: {},

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
  panelWidth: 360,
  panelTab: 'synth',
  hudVisible: true,

  helpSeen: false,
  helpAutoOpen: true,
  helpActiveTab: 'quickstart',

  timelineDock: 'hidden',
  timelineLastDock: 'bottom',
  timelineHeight: 220,
  timelineInspectorWidth: 220,
  activeTimelineId: null,
  timelineReadoutFormat: 'bars',
  timelineReadoutFps: 30,
  timelineReadoutSampleRate: 48000,

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
  recordIncludeVideoAudio: false,
  recordBitrateMbps: 25,
  recordPreferredFormat: 'auto',
  recordFps: 60,

  midiInputId: '',
  midiOutputId: '',
  midiClockOutEnabled: false,
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

  // ---------- CV (v9) ----------
  cvEnabled: false,
  cvDeviceId: '',
  cvRequestedChannels: 8,
  cvChannels: [],            // grown on first start() to detected count
  cvBridgeChannels: [],
  gamepadIndex: -1,
  gamepadDeadzone: 0.05,

  // ---------- CV output (v9) ----------
  cvOutputEnabled: false,
  cvOutputDeviceId: '',
  cvOutputChannelCount: 8,
  cvOutputChannels: [],

  // ---------- Sonification (v10) ----------
  sonification: { ...DEFAULT_SONIFICATION, mappings: { ...DEFAULT_SONIFICATION.mappings } },

  // ---------- WebXR (v11) ----------
  xrMeshScale: 'tabletop',
  xrAutoEndOnVisibilityChange: true,
  xrPerformanceProfile: 'balanced',

  // ---------- Stereoscopic recording (v12) ----------
  stereoRecordingEnabled: false,
  stereoIpdCm: 6.3,
  stereoInjectMetadata: true,
  stereoFormat: 'side-by-side',
  anaglyphEnabled: false,
  anaglyphIpdCm: 6.4,
};

// --------------------------------------------------------------------
// Persistence + migration
// --------------------------------------------------------------------

const STORAGE_KEY = 'ruttetra.settings.v1';
const CURRENT_VERSION = 28;

interface Versioned { _v?: number }

// --------------------------------------------------------------------
// Transient migration notices
// --------------------------------------------------------------------
//
// Some migrations need to surface info to the user (e.g. "we dropped your
// per-timeline BPMs, restore them manually") rather than silently picking
// a value. Migration code pushes user-facing strings here; the UI reads
// and clears them on first paint and shows a one-time toast.
//
// Pure module state — does not persist across reloads. Intentional: the
// notice is only meaningful for the migration that just ran.
const _migrationNotices: string[] = [];

export function pushMigrationNotice(msg: string): void {
  _migrationNotices.push(msg);
}

export function consumeMigrationNotices(): string[] {
  if (_migrationNotices.length === 0) return [];
  const out = _migrationNotices.slice();
  _migrationNotices.length = 0;
  return out;
}

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
      s.modSlots = (s.modSlots as unknown[]).map((rawSlot) => {
        const slot = (rawSlot ?? {}) as Record<string, unknown>;
        // Preserve any legacy `clockSync` boolean here; the v7 → v8 step
        // below converts it into the new `syncMode` enum and deletes the
        // legacy field. Cast through `unknown` because legacy data carries
        // fields that aren't on the current `ModSlot` type.
        return {
          ...DEFAULT_MOD_SLOT,
          ...slot,
          bandIndex:      (slot.bandIndex      as number  | undefined) ?? 0,
          clockSync:      (slot.clockSync      as boolean | undefined) ?? false,
          clockDivision:  (slot.clockDivision  as ClockDivision | undefined) ?? '1/4',
          midiOutEnabled: (slot.midiOutEnabled as boolean | undefined) ?? false,
          midiOutChannel: (slot.midiOutChannel as number  | undefined) ?? 1,
          midiOutCC:      (slot.midiOutCC      as number  | undefined) ?? 1,
        } as unknown as ModSlot;
      });
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

  // ---- v6 -> v7: Render resolution selector ----
  if ((s._v ?? 1) < 7) {
    s.renderResolutionId     = (s.renderResolutionId     as string  | undefined) ?? 'match';
    s.renderFitMode          = (s.renderFitMode          as FitMode | undefined) ?? 'letterbox';
    s.renderResolutionCustomW = (s.renderResolutionCustomW as number | undefined) ?? 1920;
    s.renderResolutionCustomH = (s.renderResolutionCustomH as number | undefined) ?? 1080;
    s._v = 7;
  }

  // ---- v7 -> v8: Classic patch inline controls + shared internalBpm ----
  // - Convert legacy per-slot `clockSync: boolean` → `syncMode` enum and
  //   delete the legacy field (no read-only retention; dead-but-read fields
  //   rot — see master spec).
  // - Add v8 ModSlot fields with defaults sourced from `DEFAULT_MOD_SLOT`.
  // - Introduce `internalBpm` (default 120) and `modSlotExpanded` UI state.
  //   We do NOT silently import any historical Timeline BPM here. The
  //   timeline store migration in `sequencer/store.ts` collects non-120
  //   values and pushes a `pushMigrationNotice` so the UI can surface a
  //   one-time toast.
  if ((s._v ?? 1) < 8) {
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as unknown[]).map((rawSlot) => {
        const slot = (rawSlot ?? {}) as Record<string, unknown>;
        const legacyClockSync = slot.clockSync;
        const syncMode: SyncMode = (slot.syncMode as SyncMode | undefined)
          ?? (legacyClockSync === true ? 'midi' : 'free');
        // Build the v8 slot from defaults, then re-overlay incoming raw
        // fields, then explicitly set the converted/new fields.
        const next: ModSlot = {
          ...DEFAULT_MOD_SLOT,
          ...(slot as Partial<ModSlot>),
          syncMode,
          lfoDepth:      (slot.lfoDepth      as number  | undefined) ?? DEFAULT_MOD_SLOT.lfoDepth,
          lfoUnipolar:   (slot.lfoUnipolar   as boolean | undefined) ?? DEFAULT_MOD_SLOT.lfoUnipolar,
          audioAttackMs: (slot.audioAttackMs as number  | undefined) ?? DEFAULT_MOD_SLOT.audioAttackMs,
          audioReleaseMs:(slot.audioReleaseMs as number | undefined) ?? DEFAULT_MOD_SLOT.audioReleaseMs,
          audioGain:     (slot.audioGain     as number  | undefined) ?? DEFAULT_MOD_SLOT.audioGain,
          audioFloor:    (slot.audioFloor    as number  | undefined) ?? DEFAULT_MOD_SLOT.audioFloor,
          joystickSmoothMs: (slot.joystickSmoothMs as number  | undefined) ?? DEFAULT_MOD_SLOT.joystickSmoothMs,
          joystickDeadzone: (slot.joystickDeadzone as number  | undefined) ?? DEFAULT_MOD_SLOT.joystickDeadzone,
          joystickInvert:   (slot.joystickInvert   as boolean | undefined) ?? DEFAULT_MOD_SLOT.joystickInvert,
          rampLoop:      (slot.rampLoop      as boolean | undefined) ?? DEFAULT_MOD_SLOT.rampLoop,
          outputCurve:   (slot.outputCurve   as OutputCurve | undefined) ?? DEFAULT_MOD_SLOT.outputCurve,
          outputMin:     (slot.outputMin     as number  | undefined) ?? DEFAULT_MOD_SLOT.outputMin,
          outputMax:     (slot.outputMax     as number  | undefined) ?? DEFAULT_MOD_SLOT.outputMax,
          outputOffset:  (slot.outputOffset  as number  | undefined) ?? DEFAULT_MOD_SLOT.outputOffset,
          outputInvert:  (slot.outputInvert  as boolean | undefined) ?? DEFAULT_MOD_SLOT.outputInvert,
          constantValue: (slot.constantValue as number  | undefined) ?? DEFAULT_MOD_SLOT.constantValue,
        };
        // Drop the legacy field so it doesn't rot on disk.
        delete (next as unknown as Record<string, unknown>).clockSync;
        return next;
      });
    }

    s.internalBpm      = (s.internalBpm      as number    | undefined) ?? 120;
    s.modSlotExpanded  = Array.isArray(s.modSlotExpanded)
      ? (s.modSlotExpanded as boolean[]).slice()
      : ((s.modSlots as ModSlot[] | undefined)?.map(() => false) ?? [false, false, false, false]);

    s._v = 8;
  }

  // v8 -> v9: external CV input. New per-slot fields default to 0; new
  // top-level fields (`cvEnabled`, `cvDeviceId`, `cvChannels`,
  // `cvBridgeChannels`, `gamepadIndex`, `gamepadDeadzone`) take their
  // defaults from `DEFAULTS`. Existing patches keep working — they
  // just don't have CV sources wired.
  if ((s._v ?? 1) < 9) {
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as ModSlot[]).map((slot) => ({
        ...slot,
        cvChannel:     (slot as Partial<ModSlot>).cvChannel     ?? 0,
        gamepadIndex:  (slot as Partial<ModSlot>).gamepadIndex  ?? 0,
      }));
    }
    s._v = 9;
  }

  // v9 -> v10: Pattern Generator. Add every `pattern*` top-level key
  // from `DEFAULTS` if missing. No mutation of existing keys; rolling
  // back to v9 code drops the unknown fields harmlessly. No safety
  // reset on `patternEnabled` — patterns are purely visual, no
  // hardware risk.
  if ((s._v ?? 1) < 10) {
    const patternKeys: (keyof Settings)[] = [
      'patternEnabled', 'patternKind', 'patternBlendMode', 'patternMix',
      'patternBrightness', 'patternContrast',
      'patternFrequency', 'patternPhase',
      'patternScale', 'patternThickness', 'patternDensity',
      'patternFreqRatio', 'patternPhaseOffset',
      'patternArms', 'patternOctaves', 'patternPointDensity',
      'patternAxis', 'patternGradientShape',
      'patternScopeSourceKind', 'patternScopeSourceRef',
      'patternScopeSweep', 'patternScopeTrigger', 'patternScopePersist',
      'patternScopeThickness', 'patternScopeBeamHue',
    ];
    for (const k of patternKeys) {
      if ((s as Record<string, unknown>)[k as string] === undefined) {
        (s as Record<string, unknown>)[k as string] = DEFAULTS[k] as unknown;
      }
    }
    // Backfill the new ModSlot.patternOutputId field — old slots used
    // sources from the v9 closed set, none of which read this field, so
    // a missing value is harmless. We default to '' (no signal selected).
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as ModSlot[]).map((slot) => ({
        ...slot,
        patternOutputId: (slot as Partial<ModSlot>).patternOutputId ?? '',
      }));
    }
    // Backfill the new CVOutputChannel.sourcePatternOutputId field on
    // any saved CV-output channels. No prior version had this kind, so
    // existing channels just get an empty string.
    if (Array.isArray(s.cvOutputChannels)) {
      s.cvOutputChannels = (s.cvOutputChannels as CVOutputChannel[]).map((ch) => ({
        ...ch,
        sourcePatternOutputId: (ch as Partial<CVOutputChannel>).sourcePatternOutputId ?? '',
      }));
    }
    // Add the Sonification config block. New `s.sonification` may be
    // undefined on a v9 record. Deep-merge with DEFAULT_SONIFICATION
    // so saved partials (e.g. only `masterVolumeDb` was changed) keep
    // their values while gaining new keys with sensible defaults.
    {
      const existing = (s.sonification as Partial<SonificationConfig> | undefined) ?? {};
      const existingMappings = (existing.mappings ?? {}) as Partial<SonificationConfig['mappings']>;
      s.sonification = {
        ...DEFAULT_SONIFICATION,
        ...existing,
        // ALWAYS force-disabled on load (preset / localStorage / paste).
        // Mirrors the CV-output rule: saved configs restore, audible
        // output requires an explicit user gesture.
        enabled: false,
        mappings: {
          pitch:     { ...DEFAULT_SONIFICATION.mappings.pitch,     ...(existingMappings.pitch     ?? {}) },
          amplitude: { ...DEFAULT_SONIFICATION.mappings.amplitude, ...(existingMappings.amplitude ?? {}) },
          cutoff:    { ...DEFAULT_SONIFICATION.mappings.cutoff,    ...(existingMappings.cutoff    ?? {}) },
          resonance: { ...DEFAULT_SONIFICATION.mappings.resonance, ...(existingMappings.resonance ?? {}) },
        },
      };
    }
    s._v = 10;
  }

  // v10 -> v11: WebXR. Add the three new user-facing keys with
  // sensible defaults. The active session mode itself is NOT a
  // Settings field — it's runtime state owned by `XRManager` —
  // so no force-null-on-load carve-out is needed here. Rolling
  // back to v10 code drops the unknown fields harmlessly.
  if ((s._v ?? 1) < 11) {
    if (s.xrMeshScale === undefined) {
      s.xrMeshScale = DEFAULTS.xrMeshScale;
    }
    if (s.xrAutoEndOnVisibilityChange === undefined) {
      s.xrAutoEndOnVisibilityChange = DEFAULTS.xrAutoEndOnVisibilityChange;
    }
    if (s.xrPerformanceProfile === undefined) {
      s.xrPerformanceProfile = DEFAULTS.xrPerformanceProfile;
    }
    s._v = 11;
  }

  // v11 -> v12: Stereoscopic recording. Add the four new keys with
  // defaults. `stereoRecordingEnabled` defaults to false on purpose
  // — same posture as every other output-shaping setting on this
  // synth — but it's a persistent configuration choice, not a
  // runtime state, so it's allowed to round-trip through projects.
  // Recording still requires an explicit Start click; this toggle
  // just chooses which pipeline runs.
  if ((s._v ?? 1) < 12) {
    if (s.stereoRecordingEnabled === undefined) {
      s.stereoRecordingEnabled = DEFAULTS.stereoRecordingEnabled;
    }
    if (s.stereoIpdCm === undefined) {
      s.stereoIpdCm = DEFAULTS.stereoIpdCm;
    }
    if (s.stereoInjectMetadata === undefined) {
      s.stereoInjectMetadata = DEFAULTS.stereoInjectMetadata;
    }
    if (s.stereoFormat === undefined) {
      s.stereoFormat = DEFAULTS.stereoFormat;
    }
    s._v = 12;
  }

  // v12 -> v13: Stream URL source. One new key — the remembered URL from
  // the last "Use Stream" session. Empty string = no remembered URL.
  // The source does NOT auto-reconnect on load; this is purely a UX
  // convenience so users don't re-paste long RTSP/HLS relay URLs.
  if ((s._v ?? 1) < 13) {
    if (s.streamUrl === undefined) {
      s.streamUrl = DEFAULTS.streamUrl;
    }
    s._v = 13;
  }

  // v13 -> v14: WHIP output streaming. Two new keys for the WHIP endpoint
  // URL and optional bearer token. Both default to empty (feature off).
  // whipBearerToken is treated as a secret: it is NOT included in preset
  // exports (see serialization exclusion list below).
  if ((s._v ?? 1) < 14) {
    if (s.whipEndpoint === undefined)    s.whipEndpoint    = DEFAULTS.whipEndpoint;
    if (s.whipBearerToken === undefined) s.whipBearerToken = DEFAULTS.whipBearerToken;
    s._v = 14;
  }

  // v14 -> v15: Video audio playback (speaker + recording).
  //   videoAudioEnabled / videoAudioVolume — speaker passthrough.
  //   recordIncludeVideoAudio — bake video audio into recordings.
  // All three default to safe values (disabled / 1.0 / disabled).
  if ((s._v ?? 1) < 15) {
    if (s.videoAudioEnabled      === undefined) s.videoAudioEnabled      = DEFAULTS.videoAudioEnabled;
    if (s.videoAudioVolume       === undefined) s.videoAudioVolume       = DEFAULTS.videoAudioVolume;
    if (s.recordIncludeVideoAudio === undefined) s.recordIncludeVideoAudio = DEFAULTS.recordIncludeVideoAudio;
    s._v = 15;
  }

  // CV output safety: regardless of version, force every loaded CV-output
  // channel to start with `enabled=false`. This is the "outputs start
  // muted on page load" guarantee from the v9 spec — saved configurations
  // are restored, but the user must re-arm each channel before any
  // voltage actually leaves the interface. Likewise the master enable
  // resets to false so the output AudioContext doesn't auto-start.
  if (Array.isArray(s.cvOutputChannels)) {
    s.cvOutputChannels = (s.cvOutputChannels as CVOutputChannel[]).map((ch) => ({
      ...DEFAULT_CV_OUTPUT_CHANNEL,
      ...ch,
      enabled: false,
      pitchCalibrationActiveNote: null,
    }));
  }
  s.cvOutputEnabled = false;

  // v15 -> v16: Anaglyph viewing mode. Two new keys — enabled (default
  // false) and IPD in cm (default 6.4 = standard human IPD in metres).
  if ((s._v ?? 1) < 16) {
    if (s.anaglyphEnabled === undefined) s.anaglyphEnabled = DEFAULTS.anaglyphEnabled;
    if (s.anaglyphIpdCm   === undefined) s.anaglyphIpdCm   = DEFAULTS.anaglyphIpdCm;
    s._v = 16;
  }

  // v16 -> v17: per-node / per-binding enable flags on the graph patch.
  // Backfill `enabled: true` explicitly so saved patches carry the field
  // (missing is also treated as enabled at the engine boundary, but an
  // explicit value keeps serialized patches self-describing). Idempotent.
  if ((s._v ?? 1) < 17) {
    const g = s.modGraph as GraphPatch | null | undefined;
    if (g && typeof g === 'object' && Array.isArray(g.nodes)) {
      s.modGraph = {
        ...g,
        nodes: g.nodes.map((n) => ({ ...n, enabled: n.enabled ?? true })),
        bindings: Array.isArray(g.bindings)
          ? g.bindings.map((b) => ({ ...b, enabled: b.enabled ?? true }))
          : [],
      };
    }
    s._v = 17;
  }

  // v17 -> v18: per-slot slew (glide) on Classic slots. Both default to
  // 0 ms = off, preserving pre-v18 behavior exactly. Idempotent.
  if ((s._v ?? 1) < 18) {
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as ModSlot[]).map((slot) => ({
        ...slot,
        slewRiseMs: (slot as Partial<ModSlot>).slewRiseMs ?? 0,
        slewFallMs: (slot as Partial<ModSlot>).slewFallMs ?? 0,
      }));
    }
    s._v = 18;
  }

  // v18 -> v19: per-parameter slider range overrides. Plain empty-object
  // backfill; entries only appear when the user edits a range. Idempotent.
  if ((s._v ?? 1) < 19) {
    if (s.paramRangeOverrides === undefined || typeof s.paramRangeOverrides !== 'object' || s.paramRangeOverrides === null) {
      s.paramRangeOverrides = {};
    }
    s._v = 19;
  }

  // v19 -> v20: Classic slot apply mode (additive | multiplicative).
  // Backfill 'additive' — the only behavior that existed pre-v20.
  if ((s._v ?? 1) < 20) {
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as ModSlot[]).map((slot) => ({
        ...slot,
        mode: (slot as Partial<ModSlot>).mode ?? 'additive',
      }));
    }
    s._v = 20;
  }

  // v20 -> v21: continuous rotation knob + LFO range switch. `rotation`
  // defaults to 0 deg (identity); `freqRange` defaults to 'mid' (×1),
  // both exactly preserving pre-v21 behavior. Idempotent.
  if ((s._v ?? 1) < 21) {
    if (s.rotation === undefined) s.rotation = DEFAULTS.rotation;
    if (Array.isArray(s.modSlots)) {
      s.modSlots = (s.modSlots as ModSlot[]).map((slot) => ({
        ...slot,
        freqRange: (slot as Partial<ModSlot>).freqRange ?? 'mid',
      }));
    }
    s._v = 21;
  }

  // v21 -> v22: MIDI clock out. Backfill the toggle; the structural
  // force-off below applies on every load regardless of version.
  if ((s._v ?? 1) < 22) {
    if (s.midiClockOutEnabled === undefined) s.midiClockOutEnabled = false;
    s._v = 22;
  }
  // MIDI clock out: forced OFF on every load — outward-facing signal,
  // same posture as CV output. The user re-arms it per session.
  s.midiClockOutEnabled = false;

  // v22 -> v23: dual raster. Backfill the flag (default OFF), mode,
  // wipe position, and every raster-B key at raster-A defaults. Purely
  // visual — the flag is a persisted preference, no force-reset needed.
  if ((s._v ?? 1) < 23) {
    const dualKeys: (keyof Settings)[] = [
      'dualRasterEnabled', 'dualMode', 'dualTracePos',
      'bHPos', 'bVPos', 'bHSize', 'bVSize', 'bZPush', 'bZBias',
      'bIntensity', 'bHCenter', 'bVCenter', 'bHSpin', 'bVSpin',
      'bRotation', 'bHLinearity', 'bVLinearity',
      'bThreshold', 'bContrast', 'bGamma',
    ];
    for (const k of dualKeys) {
      if ((s as Record<string, unknown>)[k as string] === undefined) {
        (s as Record<string, unknown>)[k as string] = DEFAULTS[k] as unknown;
      }
    }
    s._v = 23;
  }

  // v23 -> v24: shape-masked feedback + analog character. Backfill at
  // defaults ('full' shape and analogEnabled=false preserve pre-v24
  // rendering exactly). Purely visual — no force-reset. Idempotent.
  if ((s._v ?? 1) < 24) {
    const fxKeys: (keyof Settings)[] = [
      'feedbackShape', 'feedbackShapeX', 'feedbackShapeY',
      'feedbackShapeRadius', 'feedbackShapeSoftness',
      'analogEnabled', 'analogNoise', 'analogDropout', 'analogHum',
    ];
    for (const k of fxKeys) {
      if ((s as Record<string, unknown>)[k as string] === undefined) {
        (s as Record<string, unknown>)[k as string] = DEFAULTS[k] as unknown;
      }
    }
    s._v = 24;
  }

  // v24 -> v25: graph input refs may now use the `nodeId#port` form to
  // select a specific output port on multi-output nodes. No data
  // transformation — plain-id refs remain valid and keep meaning "the
  // default output" — but the version bump records that files written
  // at v25 may contain the new form (v24-and-earlier code would read a
  // `#` ref as a dangling node id and treat the input as unpatched).
  if ((s._v ?? 1) < 25) {
    s._v = 25;
  }

  // v25 -> v26: resizable timeline inspector column. Pure UI-state
  // backfill; the dock clamps to 180–420 on apply. Idempotent.
  if ((s._v ?? 1) < 26) {
    s.timelineInspectorWidth = (s.timelineInspectorWidth as number | undefined) ?? 220;
    s._v = 26;
  }

  // v26 -> v27: resizable side control panel. Pure UI-state backfill;
  // the panel clamps to 280–600 on apply. Idempotent.
  if ((s._v ?? 1) < 27) {
    s.panelWidth = (s.panelWidth as number | undefined) ?? 360;
    s._v = 27;
  }

  // v27 -> v28: timeline transport counter display format (Bars/Beats,
  // Timecode, Frames, Samples). Pure UI-state backfill; a display
  // conversion, not a new clock. Idempotent.
  if ((s._v ?? 1) < 28) {
    s.timelineReadoutFormat = (s.timelineReadoutFormat as Settings['timelineReadoutFormat'] | undefined) ?? 'bars';
    s.timelineReadoutFps = (s.timelineReadoutFps as number | undefined) ?? 30;
    s.timelineReadoutSampleRate = (s.timelineReadoutSampleRate as number | undefined) ?? 48000;
    s._v = 28;
  }

  // Video audio safety: force disabled on every load. A saved "enabled"
  // state must not auto-play audio on the next page load. The user must
  // re-enable after each session (Principle 4).
  s.videoAudioEnabled = false;

  // Sonification safety: regardless of version (covers v10+ records too,
  // not just the v9→v10 step above), force `enabled=false` on every
  // load. The synth is silent by default; audible output always
  // requires an explicit user click on the Enable toggle (which also
  // satisfies browser autoplay rules — that's the natural gesture).
  if (s.sonification && typeof s.sonification === 'object') {
    s.sonification = {
      ...DEFAULT_SONIFICATION,
      ...(s.sonification as SonificationConfig),
      enabled: false,
    };
  } else {
    s.sonification = { ...DEFAULT_SONIFICATION };
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
