/**
 * Sonification — the synth's first audible output.
 *
 * A single voice (osc → biquad → amp → master → limiter → destination
 * + capture tap) whose four parameters (pitch / amplitude / cutoff /
 * resonance) are driven each frame by configurable mappings from
 * `MeshAnalyzer` statistics. Faithful to the 1970s practice (Steina
 * Vasulka, Bill Hearn) of routing video signals through audio
 * amplifiers to literally hear the image.
 *
 * Safety surface (every item in the spec's "first audio output" list):
 *   - default disabled, requires explicit user click on Enable
 *   - default master volume -18 dB
 *   - 500ms soft-start ramp on enable, 250ms ramp on disable
 *   - DynamicsCompressorNode acting as a brick-wall limiter at -3 dBFS
 *   - mic-feedback gate: when the audio envelope follower is using
 *     mic input, master is forced to 0 (overrides user volume)
 *   - autoplay deferral: if `start()` runs without a user gesture and
 *     the AudioContext is suspended, we leave the oscillator silent
 *     until a `userGesture()` call resumes the context
 *   - preset / persist always loads `enabled=false` (handled in
 *     migrateSettings — this class trusts that invariant)
 *
 * Routing isolation:
 *   - Sonification owns its own AudioContext (separate from CVOutput's
 *     context which uses a sinkId for a DC-coupled interface). This
 *     guarantees no shared mixer node. The two audio surfaces can't
 *     accidentally bleed into each other.
 *
 * Recording / broadcast capture:
 *   - A `MediaStreamAudioDestinationNode` taps off post-master and
 *     post-limiter (so the captured audio is the same audio the user
 *     hears). `getCaptureStream()` exposes the stream so the recorder
 *     and broadcaster can attach the audio track.
 */

import {
  SonificationConfig, SonificationParam, SonificationMapping, MappingCurve,
} from '../state/Settings';
import { MeshStatId, MeshStats } from './MeshAnalyzer';

/** Status snapshot for the UI. */
export interface SonificationStatus {
  /** True when the AudioContext is running and the voice oscillator
   *  has been started. */
  running: boolean;
  /** True when `enabled === true` in settings but we've deferred the
   *  actual start because the AudioContext is suspended (autoplay).
   *  The UI surfaces a "click to enable audio" indicator on this. */
  awaitingUserGesture: boolean;
  /** Set when mic-feedback gating is auto-muting the voice. The UI
   *  shows an explanatory note. */
  micFeedbackMuted: boolean;
  /** Last AudioContext error, if any. Cleared on next successful
   *  start. */
  lastError: string | null;
}

const DEFAULT_STATUS: SonificationStatus = {
  running: false,
  awaitingUserGesture: false,
  micFeedbackMuted: false,
  lastError: null,
};

/** Polite ramp constant — used everywhere we change a gain. Avoids
 *  zipper noise without adding audible attack/release. */
const PARAM_RAMP_SEC = 0.02;
/** Soft-start: ramp from -inf to user level over this many seconds. */
const SOFT_START_SEC = 0.5;
/** Soft-stop on disable / mic-feedback gating. */
const SOFT_STOP_SEC = 0.25;

/** Test-tone duration. */
const TEST_TONE_SEC = 1.0;
/** Mute Briefly duration. */
const MUTE_BRIEFLY_SEC = 2.0;

type Listener = (status: SonificationStatus) => void;

export class Sonification {
  // Audio graph nodes — created lazily on first `start()`.
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private amp: GainNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private captureDest: MediaStreamAudioDestinationNode | null = null;

  // Internal "want enabled" tracking. `cfg.enabled` is the user's
  // wish; `voiceActive` is whether we actually have an oscillator
  // running. They diverge when autoplay defers start.
  private voiceActive = false;
  /** Most recent config from settings.subscribe. Used by tick() to
   *  apply per-frame param updates without an extra read. */
  private cfg: SonificationConfig;
  /** The dB level the user has dialed in. Stored so `unmute` can
   *  restore it after Mute Briefly. */
  private userVolumeDb: number;
  /** Smoothed mapping outputs in [0, 1]. One per voice param. The
   *  smoothing slider in the UI sets the time constant. */
  private smoothed: Record<SonificationParam, number> = {
    pitch: 0.5, amplitude: 0, cutoff: 0.5, resonance: 0,
  };
  private status: SonificationStatus = { ...DEFAULT_STATUS };
  private listeners = new Set<Listener>();
  /** Set when an external observer (FFTAnalyzer "running with mic"
   *  state) wants us to gate the voice. The UI surfaces this. */
  private micFeedbackActive = false;
  /** Mute Briefly timer handle, so a second click cancels the
   *  ramp-back. */
  private muteBrieflyEndAt = 0;

  constructor(initial: SonificationConfig) {
    this.cfg = initial;
    this.userVolumeDb = initial.masterVolumeDb;
  }

  // ============== Public API: lifecycle ==============

  /**
   * Apply a settings change. Cheap — only reactive operations
   * (enable / disable, master volume change, voice config change)
   * actually touch the audio graph. Per-frame mapping changes ride
   * through `tick()` instead.
   */
  applyConfig(cfg: SonificationConfig): void {
    const prev = this.cfg;
    this.cfg = cfg;

    // Volume change: ramp the master gain to the new level (only if
    // already running and not currently mic-gated / mute-briefly).
    if (cfg.masterVolumeDb !== prev.masterVolumeDb) {
      this.userVolumeDb = cfg.masterVolumeDb;
      this.applyUserVolume();
    }
    // Voice config: push waveform / filter type changes to nodes.
    if (cfg.waveform !== prev.waveform && this.osc) {
      this.osc.type = waveformToOscillatorType(cfg.waveform);
    }
    if (cfg.filterType !== prev.filterType && this.filter) {
      this.filter.type = cfg.filterType;
    }

    // Enable transition.
    if (cfg.enabled && !prev.enabled) {
      this.softStart().catch((err) => this.recordError(err));
    } else if (!cfg.enabled && prev.enabled) {
      this.softStop();
    }
  }

  /**
   * Tell Sonification a user gesture (click / key) has occurred. If
   * we'd previously deferred `start()` waiting for one, this resumes
   * the AudioContext and begins the voice. Idempotent.
   */
  async userGesture(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.voiceActive) return;
    await this.softStart();
  }

  /** Set the mic-feedback gate. When `true`, master gain is forced
   *  to 0 regardless of user volume; the user-visible status flag
   *  is also set. Reverts on `false`. Called by the main loop's
   *  observer of FFTAnalyzer state. */
  setMicFeedbackActive(active: boolean): void {
    if (active === this.micFeedbackActive) return;
    this.micFeedbackActive = active;
    this.status.micFeedbackMuted = active;
    this.applyUserVolume();
    this.emit();
  }

  /** Subscribe to status changes. Fires once immediately. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): SonificationStatus {
    return { ...this.status };
  }

  // ============== Public API: per-frame ==============

  /**
   * Apply mesh stats to the voice's parameters. Must be called once
   * per frame from the main loop, after `meshAnalyzer.tick()`. No-op
   * when disabled, when the AudioContext isn't running, or when the
   * mic-feedback gate is active (in those states we leave the audio
   * silent rather than computing values that would be muted anyway).
   */
  tick(stats: Readonly<MeshStats>, dtSec: number): void {
    if (!this.voiceActive || !this.ctx || !this.osc || !this.filter || !this.amp) return;
    if (this.micFeedbackActive) return;

    // Update Mute Briefly auto-restore. We do this here rather than
    // setTimeout so a paused tab (rAF stalls) doesn't wake up to
    // sudden audio.
    if (this.muteBrieflyEndAt > 0 && this.ctx.currentTime >= this.muteBrieflyEndAt) {
      this.muteBrieflyEndAt = 0;
      this.applyUserVolume();
    }

    const cfg = this.cfg;
    // 1-pole lowpass time constant: τ = smoothingMs/1000. Discrete
    // coefficient α = 1 - exp(-dt/τ). Clamp τ to a small minimum so
    // smoothingMs=0 acts as "no smoothing" instead of NaN.
    const tau = Math.max(0.001, cfg.smoothingMs / 1000);
    const alpha = 1 - Math.exp(-dtSec / tau);

    for (const p of PARAM_KEYS) {
      const m = cfg.mappings[p];
      const raw = readStat(stats, m.source);
      const shaped = applyCurve(raw, m.curve);
      this.smoothed[p] = this.smoothed[p] + alpha * (shaped - this.smoothed[p]);
    }

    // Dispatch smoothed values to AudioParams. Use setTargetAtTime
    // with a short time constant so we don't get audible zipper from
    // 60Hz AudioParam.value writes.
    const t = this.ctx.currentTime;
    const ramp = PARAM_RAMP_SEC;

    // Pitch -> oscillator frequency. Map the smoothed [0,1] across
    // [pitchLowMidi, pitchHighMidi]. Quantize to nearest semitone
    // when configured.
    const [lowMidi, highMidi] = cfg.pitchRangeMidi;
    let midi = lowMidi + this.smoothed.pitch * (highMidi - lowMidi);
    if (cfg.quantize) midi = Math.round(midi);
    const hz = midiToHz(midi);
    this.osc.frequency.setTargetAtTime(hz, t, ramp);

    // Amplitude -> amp gain. 0..1 mapped through a slight curve so
    // very low brightness doesn't feel inaudible immediately.
    // Sqrt is musically friendly; users can layer additional shaping
    // via mapping curve dropdown.
    const ampGain = Math.sqrt(this.smoothed.amplitude);
    this.amp.gain.setTargetAtTime(ampGain, t, ramp);

    // Cutoff -> filter frequency. Exponential map across audible
    // band [60, 16000] so 0 = "everything closed" (60 Hz lowpass
    // cuts most musical content), 1 = "wide open".
    const cutoff = expRange(this.smoothed.cutoff, 60, 16000);
    this.filter.frequency.setTargetAtTime(cutoff, t, ramp);

    // Resonance -> Q. 0.7 (no ring) to 18 (self-oscillation just
    // out of reach). The limiter downstream catches any runaway.
    const q = 0.7 + this.smoothed.resonance * 17.3;
    this.filter.Q.setTargetAtTime(q, t, ramp);
  }

  // ============== Public API: capture / debug ==============

  /**
   * MediaStream that mirrors the voice's master output. Recorder
   * adds the track to its canvas stream, broadcaster adds it to the
   * PeerJS call. Exists for the lifetime of the AudioContext —
   * persistent across enable/disable so consumers don't have to
   * re-add the track.
   */
  getCaptureStream(): MediaStream | null {
    return this.captureDest?.stream ?? null;
  }

  /**
   * Play a 440 Hz sine for 1 second at -18 dB regardless of mesh
   * state. Disconnected from the main voice so it doesn't interrupt
   * normal sonification. Used by the UI's "Test Tone" button as a
   * "are speakers working at all?" check.
   */
  async testTone(): Promise<void> {
    const ctx = await this.ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.frequency.value = 440;
    tone.type = 'sine';
    gain.gain.value = 0;
    // Connect to the limiter so even a stuck-on test tone can't
    // exceed -3 dBFS. If the limiter doesn't exist yet, fall back
    // to direct destination (we still soft-shape the gain envelope).
    if (this.limiter) tone.connect(gain).connect(this.limiter);
    else tone.connect(gain).connect(ctx.destination);
    // -18 dB target with quick attack / release.
    const target = dbToGain(-18);
    gain.gain.setTargetAtTime(target, t, 0.01);
    gain.gain.setTargetAtTime(0, t + TEST_TONE_SEC - 0.05, 0.05);
    tone.start(t);
    tone.stop(t + TEST_TONE_SEC + 0.1);
  }

  /**
   * Drop master volume to 0 for 2 seconds, then ramp back to user
   * level. Useful while the user is patching and wants a moment of
   * silence without losing config.
   */
  muteBriefly(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.05);
    this.muteBrieflyEndAt = t + MUTE_BRIEFLY_SEC;
  }

  // ============== Internal ==============

  /** Lazily create the AudioContext + voice graph. Returns the
   *  context on success, null if the browser refuses (e.g. no
   *  AudioContext support — test environment). */
  private async ensureCtx(): Promise<AudioContext | null> {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === 'undefined') return null;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.buildVoice();
      return ctx;
    } catch (err) {
      this.recordError(err);
      return null;
    }
  }

  /** Build osc → filter → amp → master → limiter → destination, plus
   *  the parallel master → captureDest tap. */
  private buildVoice(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const cfg = this.cfg;

    const osc = ctx.createOscillator();
    osc.type = waveformToOscillatorType(cfg.waveform);
    osc.frequency.value = midiToHz((cfg.pitchRangeMidi[0] + cfg.pitchRangeMidi[1]) / 2);

    const filter = ctx.createBiquadFilter();
    filter.type = cfg.filterType;
    filter.frequency.value = 2000;
    filter.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    const master = ctx.createGain();
    master.gain.value = 0; // soft-started below.

    // Brick-wall limiter at -3 dBFS. Ratio 20 is "effectively
    // limiting" without sounding obviously squashed at moderate
    // signal levels. Knee 6 dB rounds the corner so we don't get
    // audible artifacts on near-threshold signals.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    osc.connect(filter).connect(amp).connect(master).connect(limiter).connect(ctx.destination);

    // Capture tap: mirror master output (post-limiter) to a
    // MediaStreamAudioDestinationNode so recordings / broadcasts can
    // pick up the audio without affecting the speaker output.
    const captureDest = ctx.createMediaStreamDestination();
    limiter.connect(captureDest);

    osc.start();

    this.osc = osc;
    this.filter = filter;
    this.amp = amp;
    this.master = master;
    this.limiter = limiter;
    this.captureDest = captureDest;
  }

  /**
   * Resume the AudioContext (if suspended), build the voice if
   * needed, and ramp master gain from 0 to the user's configured
   * level over 500 ms. If the resume fails (autoplay block), set
   * `awaitingUserGesture = true` so the UI prompts.
   */
  private async softStart(): Promise<void> {
    const ctx = await this.ensureCtx();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        // Autoplay blocked — voice stays silent until userGesture().
        this.status.awaitingUserGesture = true;
        this.recordError(err);
        return;
      }
    }
    this.status.awaitingUserGesture = false;

    // Soft-start ramp on master gain. The amp / filter / osc start
    // at neutral values; the master's 0 → userVolume ramp is what
    // makes "Enable" silent for the first half-second.
    if (this.master) {
      const target = this.effectiveMasterGain();
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(0, t);
      this.master.gain.linearRampToValueAtTime(target, t + SOFT_START_SEC);
    }
    this.voiceActive = true;
    this.status.running = true;
    this.emit();
  }

  /** Ramp master gain to 0 over 250 ms; flag voice as inactive. We
   *  keep the AudioContext alive to avoid the autoplay re-prompt on
   *  the next enable. */
  private softStop(): void {
    this.voiceActive = false;
    this.status.running = false;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, SOFT_STOP_SEC / 5);
    }
    this.emit();
  }

  /** Compute the master gain target accounting for the mic-feedback
   *  gate AND the user's dB setting. */
  private effectiveMasterGain(): number {
    if (this.micFeedbackActive) return 0;
    if (this.muteBrieflyEndAt > 0) return 0;
    return dbToGain(this.userVolumeDb);
  }

  private applyUserVolume(): void {
    if (!this.ctx || !this.master) return;
    if (!this.voiceActive) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.effectiveMasterGain(), t, PARAM_RAMP_SEC);
  }

  private recordError(err: unknown): void {
    this.status.lastError = err instanceof Error ? err.message : String(err);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.getStatus());
  }
}

// --------------------------------------------------------------------
// Helpers — mapping curves, units, stat lookup
// --------------------------------------------------------------------

const PARAM_KEYS: readonly SonificationParam[] = ['pitch', 'amplitude', 'cutoff', 'resonance'];

/** Look up a mesh stat by id. Returns 0 for the empty / unmapped
 *  case. Exported for unit tests. */
export function readStat(stats: Readonly<MeshStats>, id: SonificationMapping['source']): number {
  if (!id) return 0;
  return stats[id as MeshStatId] ?? 0;
}

/** Apply a mapping curve to a [0, 1] value. Output is also [0, 1]. */
export function applyCurve(v: number, curve: MappingCurve): number {
  if (!Number.isFinite(v)) v = 0;
  if (v < 0) v = 0; else if (v > 1) v = 1;
  switch (curve) {
    case 'linear':       return v;
    case 'exponential':  return v * v;                    // emphasizes high end
    case 'logarithmic':  return Math.sqrt(v);             // emphasizes low end
    case 'sCurve':       return v * v * (3 - 2 * v);      // smoothstep — flatter middle
  }
}

/** Map a [0, 1] scalar exponentially across [lo, hi]. Useful for
 *  audio frequency-domain mapping (musical perception is logarithmic). */
export function expRange(t: number, lo: number, hi: number): number {
  if (t <= 0) return lo;
  if (t >= 1) return hi;
  const ratio = hi / lo;
  return lo * Math.pow(ratio, t);
}

/** Convert dB to linear gain. -Infinity (or anything below -90 dB)
 *  becomes 0 — a true mute. */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= -90) return 0;
  return Math.pow(10, db / 20);
}

/** Standard equal-temperament MIDI-to-Hz conversion. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Map our user-facing 'saw' alias onto Web Audio's `'sawtooth'`
 *  OscillatorType. All other waveforms pass through unchanged. */
function waveformToOscillatorType(w: string): OscillatorType {
  if (w === 'saw') return 'sawtooth';
  return w as OscillatorType;
}

/** Format a MIDI note number as `C4`, `D#5`, etc. for UI dropdowns. */
export function midiToName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const m = Math.round(midi);
  const oct = Math.floor(m / 12) - 1;
  const n = ((m % 12) + 12) % 12;
  return `${names[n]}${oct}`;
}
