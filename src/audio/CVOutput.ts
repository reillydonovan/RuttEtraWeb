/**
 * Multi-channel CV output for DC-coupled audio interfaces.
 *
 * Symmetric counterpart to `CVInput`. Where `CVInput` taps the audio
 * interface as a *source* of analog voltages coming in, `CVOutput`
 * drives chosen output channels of the same (or another) DC-coupled
 * interface to send analog voltages out to external hardware
 * (Eurorack modular, CV-equipped synths, anything that accepts CV).
 *
 * **Audio isolation** is the single most important property. The
 * synth's audible audio (FFT input passthrough, audio-file playback,
 * the recorder's mic mix) lives on a separate `AudioContext` whose
 * sink is the OS default (or whatever the user has explicitly chosen).
 * `CVOutput` owns its **own** `AudioContext` whose `sinkId` points at
 * the user-selected DC-coupled interface; nothing in the audible
 * graph touches this context, so audio physically cannot bleed into
 * CV channels.
 *
 * **Output structure** within this AudioContext:
 *
 *   ┌────────────────┐
 *   │ CV worklet[0]  ├──────┐
 *   ├────────────────┤      │
 *   │ CV worklet[1]  ├──────┤    ┌────────┐
 *   │      ...       │      ├──→ │ Merger ├──→ destination
 *   ├────────────────┤      │    └────────┘    (channelCount = N)
 *   │ CV worklet[N-1]├──────┘
 *   └────────────────┘
 *
 * `ChannelMergerNode` with N inputs (one per channel exposed by the
 * interface). Each per-channel worklet connects to one specific input
 * via `worklet.connect(merger, 0, channelIndex)`. The merger routes
 * each input straight through to the matching output channel of
 * `destination`. Browsers honor `destination.channelCount = N` only on
 * channels they have a sink for; on a typical 2-channel system this
 * collapses to 2 channels, but on an ES-9 or similar it stays at 8.
 *
 * **Per-frame tick** (`tick(dt)`, called from the main render loop):
 *
 *   1. For every enabled channel, resolve the source value (read from
 *      `LiveValuesStore`, `ModMatrix.getSlotSignal()`, `GraphEngine`'s
 *      compiled outputs, the MIDI mapping's last-note state, or a
 *      hard-coded constant).
 *   2. Run the source value through the channel's `type` processor:
 *        cv      — direct mapping
 *        gate    — threshold compare → 0 / `gateHighV`
 *        trigger — rising-edge detect → schedule a fixed-duration pulse
 *        clock   — phase advance from BPM and division → square wave
 *        pitch   — 1V/octave math + optional quantize-to-scale + glide
 *   3. Map volts → sample by dividing by the range full-scale, then
 *      `postMessage({type:'target', value})` to the worklet.
 *
 * The channel never writes to `Settings` and never appears in
 * `LiveValuesStore`. CV output is a one-way sink; reading from it
 * makes no sense.
 */

import workletUrl from './cv-out-worklet.js?url';
import {
  CVOutputChannel, CVOutType, CVRange, ClockDivision,
  DEFAULT_CV_OUTPUT_CHANNEL, SettingsStore,
} from '../state/Settings';
import { LiveValuesStore } from '../modulation/LiveValues';
import { divisionToHz } from '../modulation/tempo';

const STARTUP_RAMP_MS = 100;
const TEST_VOLTAGE = 2.5;

export interface CVOutputStatus {
  /** True when the AudioContext is alive AND the master toggle is on. */
  running: boolean;
  /** Effective channel count granted by the destination (may be lower
   *  than requested if the interface or browser limited us). */
  channelCount: number;
  deviceLabel: string;
  error: string | null;
  /** True if the browser doesn't support `setSinkId` for AudioContext.
   *  Surfaces a Chrome-required notice in the UI. */
  setSinkIdSupported: boolean;
}

export type CVOutputStatusListener = (s: CVOutputStatus) => void;

interface ChannelHandle {
  cfg: CVOutputChannel;
  /** Per-channel worklet. */
  node: AudioWorkletNode;
  // -------- per-type runtime state --------
  /** Rising-edge detection: previous source value (for trigger). */
  prevSource: number;
  /** Currently-active trigger pulse remaining (ms). */
  triggerRemainingMs: number;
  /** Clock phase 0..1, advances on every tick. */
  clockPhase: number;
  /** Glide-in-progress voltage for pitch type. */
  pitchCur: number;
  /** Last enable state — used to detect the false→true edge for ramp. */
  wasEnabled: boolean;
}

export class CVOutput {
  private ctx: AudioContext | null = null;
  private merger: ChannelMergerNode | null = null;
  /** mediaDevices ID currently driving the AudioContext's sinkId. */
  private currentSinkId: string | null = null;
  /** Fixed test-mode voltage override (applied when running calibrate /
   *  test). When non-null, completely overrides source resolution. */
  private testVoltageByChannelId = new Map<string, number>();

  /** External-source caches set by ModMatrix (Classic) and GraphEngine
   *  (Graph) before each `tick(dt)` runs. Keyed on channelIndex.
   *  Cleared at the start of every tick — engines repopulate them. */
  private classicSources = new Map<number, number>();
  private graphSources = new Map<number, number>();

  private channels = new Map<string, ChannelHandle>();
  private listeners = new Set<CVOutputStatusListener>();
  private status: CVOutputStatus = {
    running: false,
    channelCount: 0,
    deviceLabel: '',
    error: null,
    setSinkIdSupported: typeof AudioContext !== 'undefined' && (
      'setSinkId' in AudioContext.prototype
      // Chrome accepts `sinkId` in the constructor options bag.
      || true
    ),
  };

  /** Latest `lastNote` per MIDI channel — for `pitch` source kind.
   *  Wired by `setMidiNoteSource`; we don't import `MidiMapping`
   *  directly to keep this class subsystem-light. */
  private getLastMidiNote: (() => { note: number; velocity: number } | null) = () => null;

  /** Pattern signal bus — null until `setPatternBus` is called. The
   *  `'pattern-output'` source kind reads from here. Kept as a duck-
   *  typed object so this module stays renderer-import-free. */
  private patternBus: { get(id: string): number } | null = null;

  constructor(
    private settings: SettingsStore,
    private live: LiveValuesStore,
  ) {
    // React to per-channel config changes — re-publish smoothing and
    // update the worklet's enabled flag without restarting the context.
    settings.subscribe('cvOutputChannels', (next) => {
      this.syncChannelConfigs(next);
    });
    settings.subscribe('cvOutputEnabled', (on) => {
      if (!on) this.muteAll();
    });
  }

  /** Wire a function returning the freshest MIDI-note source. The
   *  CVOutput tick reads this for `sourceKind: 'midi-note'` channels. */
  setMidiNoteProvider(fn: () => { note: number; velocity: number } | null): void {
    this.getLastMidiNote = fn;
  }

  /** Used by ModMatrix when a slot's target is `cv:<n>`. The slot's
   *  post-output-stage value lands here; the next `tick()` consumes it. */
  setClassicSource(channelIndex: number, value: number): void {
    this.classicSources.set(channelIndex, value);
  }

  /** Wire the pattern signal bus. Channels with `sourceKind:
   *  'pattern-output'` read from this each tick. */
  setPatternBus(bus: { get(id: string): number } | null): void {
    this.patternBus = bus;
  }

  /** Used by the Graph `cv-output` node. */
  setGraphSource(channelIndex: number, value: number): void {
    this.graphSources.set(channelIndex, value);
  }

  subscribe(fn: CVOutputStatusListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  get running(): boolean { return this.status.running; }
  get channelCount(): number { return this.status.channelCount; }

  /**
   * Create the AudioContext, load the worklet module, and connect a
   * `ChannelMergerNode` of the requested size to `destination`.
   * `deviceId` is the mediaDevices ID of the DC-coupled output
   * interface; pass empty string to use the OS default.
   */
  async start(opts: { deviceId: string; channelCount: number }): Promise<void> {
    await this.stop();
    const channelCount = Math.max(1, Math.min(64, opts.channelCount | 0 || 8));

    let ctx: AudioContext;
    try {
      // Prefer the constructor option (no permission re-prompt). Chrome
      // 110+ + Edge support this; older browsers ignore the option, in
      // which case we still try `setSinkId` below.
      const ctor = AudioContext as unknown as new (opts: AudioContextOptions & { sinkId?: string }) => AudioContext;
      ctx = new ctor({
        latencyHint: 'interactive',
        sinkId: opts.deviceId || undefined,
      });
    } catch (err) {
      this.setStatus({ ...this.status, error: `AudioContext failed: ${(err as Error).message}` });
      throw err;
    }

    // If the browser supports `setSinkId` and a deviceId was provided,
    // make absolutely sure the sink is correct. (Some Chrome builds
    // accepted the constructor opt but didn't honor it — `setSinkId`
    // is the belt-and-braces step.)
    const ctxAny = ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
    if (opts.deviceId && typeof ctxAny.setSinkId === 'function') {
      try { await ctxAny.setSinkId(opts.deviceId); }
      catch { /* fall through — the user may need OS-level routing */ }
    }
    this.currentSinkId = opts.deviceId || null;
    this.ctx = ctx;

    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (err) {
      await this.stop();
      this.setStatus({ ...this.status, error: `Failed to load CV-out worklet: ${(err as Error).message}` });
      throw err;
    }

    // Match the destination to the requested channel count. Browsers
    // clamp to whatever the interface actually has; we surface the
    // effective number via the status object.
    const max = ctx.destination.maxChannelCount || 2;
    const effective = Math.min(channelCount, max);
    try {
      ctx.destination.channelCount = effective;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';
    } catch { /* some browsers dislike re-setting these — best effort */ }

    const merger = ctx.createChannelMerger(effective);
    merger.connect(ctx.destination);
    this.merger = merger;

    // Pull-from-suspend if the user already gestured. AudioContext
    // ignores this when a gesture hasn't happened yet; we surface the
    // gesture-required state via the UI's "click Start" button which
    // already counts as a gesture.
    try { await ctx.resume(); } catch { /* noop */ }

    this.setStatus({
      running: true,
      channelCount: effective,
      deviceLabel: '',
      error: null,
      setSinkIdSupported: typeof ctxAny.setSinkId === 'function',
    });

    // Build per-channel worklets for the configured channels. All start
    // disabled — the worklet emits zero until the user re-arms.
    this.syncChannelConfigs(this.settings.get('cvOutputChannels'));
  }

  async stop(): Promise<void> {
    this.muteAll();
    for (const h of this.channels.values()) {
      try { h.node.port.onmessage = null; } catch { /* noop */ }
      try { h.node.disconnect(); } catch { /* noop */ }
    }
    this.channels.clear();
    if (this.merger) {
      try { this.merger.disconnect(); } catch { /* noop */ }
      this.merger = null;
    }
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* noop */ }
      this.ctx = null;
    }
    this.currentSinkId = null;
    this.classicSources.clear();
    this.graphSources.clear();
    this.testVoltageByChannelId.clear();
    this.setStatus({ ...this.status, running: false, channelCount: 0, deviceLabel: '' });
  }

  /**
   * Per-frame tick — called from the main render loop. Resolves source
   * value, runs type processor, posts target to worklet. Idempotent on
   * multiple calls per frame (no internal state advances on the SAME
   * `dt`); the engines call once per render frame.
   */
  tick(dt: number): void {
    if (!this.ctx || !this.merger) return;
    const masterOn = this.settings.get('cvOutputEnabled');

    for (const h of this.channels.values()) {
      const cfg = h.cfg;
      const enabled = masterOn && cfg.enabled;

      // Edge-detect false→true so the worklet arms its 0V→target ramp.
      if (enabled !== h.wasEnabled) {
        try { h.node.port.postMessage({ type: 'enable', value: enabled }); }
        catch { /* noop — context may be torn down */ }
        h.wasEnabled = enabled;
      }
      if (!enabled) continue;

      const voltage = this.computeVoltage(h, cfg, dt);
      const sample = this.voltsToSample(voltage, cfg.voltageRange);
      try { h.node.port.postMessage({ type: 'target', value: sample }); }
      catch { /* worklet died — ignore */ }
    }

    // Engines repopulate these every frame — clear so a stale value
    // from the previous frame doesn't leak into the next when an
    // engine is disabled mid-session.
    this.classicSources.clear();
    this.graphSources.clear();
  }

  // -------------------- per-channel API (UI) --------------------

  /** Capture a fixed test voltage on one channel. Pass `null` to clear. */
  setTestVoltage(channelId: string, volts: number | null): void {
    if (volts == null) this.testVoltageByChannelId.delete(channelId);
    else this.testVoltageByChannelId.set(channelId, volts);
  }

  /** Mute the whole subsystem (every channel goes to 0V immediately). */
  muteAll(): void {
    for (const h of this.channels.values()) {
      try { h.node.port.postMessage({ type: 'enable', value: false }); }
      catch { /* noop */ }
      h.wasEnabled = false;
    }
  }

  /**
   * Resume the AudioContext after a user gesture. Needed because
   * Chrome blocks AudioContext until the user has clicked something.
   * The "Start CV Output" button in the UI already counts.
   */
  async resume(): Promise<void> {
    if (this.ctx) await this.ctx.resume().catch(() => {});
  }

  // ====================================================================
  // Internals
  // ====================================================================

  private setStatus(next: CVOutputStatus): void {
    this.status = next;
    for (const fn of this.listeners) fn(next);
  }

  /**
   * Reconcile the worklet bank with the current settings array.
   * Removes worklets for deleted channels, adds worklets for new
   * channels, updates configs in-place for existing channels. Smoothing
   * + enable changes are pushed to the worklet via postMessage.
   */
  private syncChannelConfigs(channels: CVOutputChannel[]): void {
    if (!this.ctx || !this.merger) {
      // Not running — nothing to do; on `start()` we'll re-sync.
      return;
    }
    const seen = new Set<string>();
    for (const cfg of channels) {
      seen.add(cfg.id);
      const existing = this.channels.get(cfg.id);
      if (!existing) {
        // Build a new worklet for this channel.
        const node = new AudioWorkletNode(this.ctx, 'cv-out-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        const ch = Math.max(0, Math.min(this.merger.numberOfInputs - 1, cfg.channelIndex | 0));
        node.connect(this.merger, 0, ch);
        node.port.postMessage({ type: 'smooth', ms: cfg.smoothMs });
        // Channels start with `enabled=false` — `tick()` flips it true
        // on the next frame if the user has armed the channel.
        node.port.postMessage({ type: 'enable', value: false });
        this.channels.set(cfg.id, {
          cfg: { ...cfg },
          node,
          prevSource: 0,
          triggerRemainingMs: 0,
          clockPhase: 0,
          pitchCur: cfg.pitchReferenceVoltage ?? 0,
          wasEnabled: false,
        });
      } else {
        // Update existing — push smoothing change if it shifted.
        if (existing.cfg.smoothMs !== cfg.smoothMs) {
          try { existing.node.port.postMessage({ type: 'smooth', ms: cfg.smoothMs }); }
          catch { /* noop */ }
        }
        // If the channel index moved, re-connect to the new merger input.
        if (existing.cfg.channelIndex !== cfg.channelIndex) {
          try { existing.node.disconnect(); } catch { /* noop */ }
          const ch = Math.max(0, Math.min(this.merger.numberOfInputs - 1, cfg.channelIndex | 0));
          existing.node.connect(this.merger, 0, ch);
        }
        existing.cfg = { ...cfg };
      }
    }
    // Drop worklets for removed channels.
    for (const id of [...this.channels.keys()]) {
      if (seen.has(id)) continue;
      const h = this.channels.get(id)!;
      try { h.node.port.postMessage({ type: 'enable', value: false }); } catch { /* noop */ }
      try { h.node.disconnect(); } catch { /* noop */ }
      this.channels.delete(id);
    }
  }

  /** Resolve the channel's source value (a normalized signal -1..1
   *  for cv/gate/trigger/clock; for `pitch`, the source value IS a
   *  MIDI note number, NOT normalized). */
  private resolveSource(cfg: CVOutputChannel): number {
    const test = this.testVoltageByChannelId.get(cfg.id);
    if (test != null) return test; // test mode bypasses the type pipeline downstream

    // External engine drivers always win over the channel's static
    // source binding — that way a Classic Target or Graph cv-output
    // node has unambiguous priority.
    const fromGraph = this.graphSources.get(cfg.channelIndex);
    if (fromGraph != null) return fromGraph;
    const fromClassic = this.classicSources.get(cfg.channelIndex);
    if (fromClassic != null) return fromClassic;

    switch (cfg.sourceKind) {
      case 'classic-slot': {
        // No engine pushed for this channel index this frame — quietly
        // emit zero. (The user can repoint the slot's Target if this is
        // unexpected.)
        return 0;
      }
      case 'graph-node':
        return 0;
      case 'settings-param': {
        if (!cfg.sourceParam) return 0;
        // Read the live (post-modulation) value of the Settings key.
        // For most params 0..1 isn't the natural range, so we don't
        // try to remap here — the user picks `scale` and `offset` on
        // the channel to taste.
        const v = this.live.getLive(cfg.sourceParam);
        return typeof v === 'number' ? v : 0;
      }
      case 'midi-note': {
        const last = this.getLastMidiNote();
        return last == null ? 60 : last.note;
      }
      case 'auto':
        return 0; // clock-type uses BPM directly; others see 0.
      case 'constant':
        return cfg.sourceConstant ?? 0;
      case 'pattern-output': {
        if (!this.patternBus) return 0;
        const id = cfg.sourcePatternOutputId ?? '';
        if (!id) return 0;
        // Bus values are already in their natural normalized range
        // (-1..1 bipolar / 0..1 unipolar). Channel `scale` + `offset`
        // do per-channel calibration on top.
        return this.patternBus.get(id);
      }
    }
  }

  /** The big one — converts source value to volts, dispatching by type. */
  private computeVoltage(h: ChannelHandle, cfg: CVOutputChannel, dt: number): number {
    // Test mode short-circuits the type pipeline.
    const test = this.testVoltageByChannelId.get(cfg.id);
    if (test != null) return test;

    const src = this.resolveSource(cfg);
    const scaled = src * cfg.scale;

    switch (cfg.type) {
      case 'cv': {
        const fs = rangeFullScaleVolts(cfg.voltageRange);
        // Source is -1..1 (or 0..1 if unipolar) — map to volts.
        let volts = scaled * fs;
        if (cfg.polarity === 'unipolar') {
          // 0..1 source → 0..fs volts, plus offset.
          volts = Math.max(0, Math.min(1, scaled)) * fs;
        }
        return volts + cfg.offset;
      }
      case 'gate': {
        const above = scaled > (cfg.gateThreshold ?? 0.5);
        return (above ? (cfg.gateHighV ?? 5) : (cfg.gateLowV ?? 0)) + cfg.offset;
      }
      case 'trigger': {
        // Rising-edge detect on the scaled source. When the trigger is
        // already firing, ride out the configured pulse width.
        const threshold = cfg.triggerThreshold ?? 0.1;
        const rising = h.prevSource <= threshold && scaled > threshold;
        h.prevSource = scaled;
        if (rising) {
          h.triggerRemainingMs = Math.max(1, cfg.triggerMs ?? 10);
        }
        if (h.triggerRemainingMs > 0) {
          h.triggerRemainingMs -= dt * 1000;
          return (cfg.triggerV ?? 5) + cfg.offset;
        }
        return cfg.offset;
      }
      case 'clock': {
        // Phase advances at division frequency; high during the first
        // `clockPulsePct` of each period.
        const bpm = this.settings.get('internalBpm') as number;
        const hz = divisionToHz((cfg.clockDivision ?? '1/16') as ClockDivision, bpm);
        h.clockPhase += dt * hz;
        if (h.clockPhase >= 1) h.clockPhase -= Math.floor(h.clockPhase);
        const high = h.clockPhase < (cfg.clockPulsePct ?? 0.5);
        return (high ? (cfg.clockAmpV ?? 5) : 0) + cfg.offset;
      }
      case 'pitch': {
        // For pitch, source value IS a MIDI note number. Calibration UI
        // can override with a fixed reference note for tuning.
        const refNote = cfg.pitchReferenceNote ?? 60;
        const refV    = cfg.pitchReferenceVoltage ?? 0;
        const vpo     = (cfg.pitchVoltsPerOctave ?? 1) * (cfg.pitchCalibrationScale ?? 1);
        let note = cfg.pitchCalibrationActiveNote ?? src;
        if (cfg.pitchQuantize) note = quantizeNote(note, cfg.pitchScale ?? 'chromatic', cfg.pitchScaleRoot ?? 0);
        const target = refV + ((note - refNote) / 12) * vpo;
        // Glide between target and current using a 1-pole lerp.
        const glideMs = cfg.pitchGlideMs ?? 0;
        if (glideMs > 0) {
          const k = 1 - Math.exp(-(dt * 1000) / glideMs);
          h.pitchCur = h.pitchCur + (target - h.pitchCur) * k;
        } else {
          h.pitchCur = target;
        }
        return h.pitchCur + cfg.offset;
      }
    }
  }

  /** Map volts to a -1..1 audio sample given the configured range.
   *  Hard-clamped so the worklet's safety clamp is never the only line
   *  of defense. */
  private voltsToSample(volts: number, range: CVRange): number {
    const fs = rangeFullScaleVolts(range);
    let s: number;
    if (range === '0-5V' || range === '0-10V') {
      // 0..fs volts → -1..1 sample (with 0V at sample -1 and fs at +1).
      // i.e. unipolar voltage maps over the full sample swing so the
      // interface uses its full dynamic range.
      s = (volts / fs) * 2 - 1;
    } else {
      s = volts / fs;
    }
    if (!Number.isFinite(s)) return 0;
    if (s > 1) return 1;
    if (s < -1) return -1;
    return s;
  }
}

// =====================================================================
// Pure helpers (exported for tests)
// =====================================================================

export function rangeFullScaleVolts(range: CVRange): number {
  switch (range) {
    case '+/-5V':  return 5;
    case '0-5V':   return 5;
    case '+/-10V': return 10;
    case '0-10V':  return 10;
  }
}

/**
 * 1V/octave note→volts. Exported separately for both the test suite
 * and any UI that wants to preview "what voltage will this note send?"
 *
 *   voltage = referenceVoltage + ((midiNote - referenceNote) / 12) * voltsPerOctave * calibrationScale
 *
 *  - Eurorack convention: referenceNote=60 (C4), referenceVoltage=0V,
 *    voltsPerOctave=1.0 → C5 → +1V, C3 → -1V, C#4 → +0.0833V.
 *  - Buchla convention: voltsPerOctave=1.2 (1.2V/oct).
 *  - Calibration trim: small multiplier (0.95–1.05) compensating for
 *    DAC nonlinearity on cheaper interfaces.
 */
export function pitchVoltageForNote(
  note: number,
  referenceNote = 60,
  referenceVoltage = 0,
  voltsPerOctave = 1,
  calibrationScale = 1,
): number {
  return referenceVoltage + ((note - referenceNote) / 12) * voltsPerOctave * calibrationScale;
}

/** Snap a MIDI note (possibly fractional) to the nearest semitone within
 *  the chosen scale, rooted at `scaleRoot` (0..11, where 0=C). */
export function quantizeNote(
  note: number,
  scale: NonNullable<CVOutputChannel['pitchScale']>,
  scaleRoot: number,
): number {
  if (scale === 'chromatic') return Math.round(note);
  const SCALE_INTERVALS: Record<Exclude<NonNullable<CVOutputChannel['pitchScale']>, 'chromatic'>, number[]> = {
    'major':            [0, 2, 4, 5, 7, 9, 11],
    'minor':            [0, 2, 3, 5, 7, 8, 10],
    'harmonic-minor':   [0, 2, 3, 5, 7, 8, 11],
    'pentatonic-major': [0, 2, 4, 7, 9],
    'pentatonic-minor': [0, 3, 5, 7, 10],
  };
  const intervals = SCALE_INTERVALS[scale];
  const rounded = Math.round(note);
  const offsetFromRoot = ((rounded - scaleRoot) % 12 + 12) % 12;
  // Find the nearest scale degree to the offset.
  let best = intervals[0];
  let bestDist = Math.abs(offsetFromRoot - intervals[0]);
  for (let i = 1; i < intervals.length; i++) {
    const d = Math.abs(offsetFromRoot - intervals[i]);
    if (d < bestDist) { bestDist = d; best = intervals[i]; }
  }
  return rounded - offsetFromRoot + best;
}

// Touch unused import so re-exports at module scope don't pull the symbol
// out from under the static analyzer.
void DEFAULT_CV_OUTPUT_CHANNEL;
void STARTUP_RAMP_MS;
void TEST_VOLTAGE;
