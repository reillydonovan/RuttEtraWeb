/**
 * Modulation matrix — emulates the original Rutt/Etra modular components:
 * Ramp Generator, Waveform Generator (sine/tri/square/saw/pulse with duty),
 * Audio Interface (mic envelope follower), Joystick, plus a "constant"
 * source for fixed-value patches.
 *
 * v8 inline-controls extensions:
 *   - Per-slot `syncMode` ∈ {free, midi, tempo} replaces the legacy
 *     `clockSync: boolean`. Rates resolve through `tempo.ts` helpers
 *     (single source of truth shared with MidiClock + Graph clock node).
 *   - MIDI sync HOLDS at `lastSyncedHz` when the clock is silent — no
 *     silent fallback to internal BPM (per master spec).
 *   - LFO sources gain `lfoDepth` (pre-amount amplitude) and `lfoUnipolar`
 *     (remap -1..1 → 0..1) shaping.
 *   - Audio sources gain a per-slot attack/release envelope follower
 *     plus `audioGain` and `audioFloor` (noise gate).
 *   - Joystick sources gain per-slot smoothing (1-pole LP), deadzone,
 *     and invert.
 *   - Ramp gains `rampLoop`: when false, runs once and holds at end value.
 *   - All sources flow through a shared output stage:
 *     `applyOutputStage()` → curve, clamp(min,max), offset, invert.
 *   - `retriggerSlot(i)` resets per-slot phase/state for that slot.
 *
 * Each frame, every enabled slot computes a value in [-1, +1] (or 0..1
 * for unipolar LFO), is run through the output stage, scaled by `amount`,
 * and summed into the base value of its target Settings parameter.
 */

import { ClockDivision, ModSlot, ModTarget, Settings, SettingsStore } from '../state/Settings';
import { FFTAnalyzer } from '../audio/FFTAnalyzer';
import { BeatDetector } from '../audio/BeatDetector';
import { MidiClock } from '../midi/MidiClock';
import { MidiManager } from '../midi/MidiManager';
import { MidiMapping } from '../midi/MidiMapping';
import { OscClient } from '../osc/OscClient';
import { activeTargetsBus } from './ActiveTargetsBus';
import { divisionToHz } from './tempo';
import { applyOutputStage } from './outputStage';

/**
 * Diagnostic toggle. Set `localStorage.RW_MOD_DEBUG = '1'` (or open the
 * console and run `window.RW_MOD_DEBUG = true`) to print one slot signal
 * snapshot per slot per second from `tick()`. Off by default so it can't
 * spam the console for non-debugging users.
 */
function debugLogEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { RW_MOD_DEBUG?: unknown };
  if (w.RW_MOD_DEBUG) return true;
  try { return localStorage.getItem('RW_MOD_DEBUG') === '1'; } catch { return false; }
}

interface JoystickState {
  x: number; y: number; z: number;
}

/** Per-slot per-frame persistent state. */
interface SlotState {
  /** Time (sec) at which the ramp was retriggered, for ramp sources. */
  rampStart: number | null;
  /** Audio envelope follower output, 0..1. */
  audioEnv: number;
  /** Smoothed joystick axes (post 1-pole LP). */
  joystickX: number;
  joystickY: number;
  joystickZ: number;
  /**
   * Last Hz value derived from MIDI clock; used to HOLD the rate when
   * the clock goes silent (no silent fallback to internal BPM).
   */
  lastSyncedHz: number;
  /**
   * Locally integrated phase for sync modes other than `'free'` (which
   * uses the global `now` clock). Keeps the LFO continuous when the
   * effective Hz changes mid-stream (tempo nudge, division change, etc.).
   */
  syncedPhase: number;
}

function makeSlotState(): SlotState {
  return {
    rampStart: null,
    audioEnv: 0,
    joystickX: 0,
    joystickY: 0,
    joystickZ: 0,
    lastSyncedHz: 0,
    syncedPhase: 0,
  };
}

export interface ModMatrixDeps {
  fft?: FFTAnalyzer;
  beat?: BeatDetector;
  midiClock?: MidiClock;
  midiMapping?: MidiMapping;
  midiManager?: MidiManager;
  osc?: OscClient;
}

export class ModMatrix {
  private startTime = performance.now() / 1000;
  private bases = new Map<ModTarget, number>();
  /** Targets we've already wired a `subscribe()` listener on. */
  private baseSubscribed = new Set<ModTarget>();
  /** True while `tick()` is calling `settings.set()`. Self-write guard. */
  private writingFromTick = false;
  private joystick: JoystickState = { x: 0, y: 0, z: 0 };
  private slotStates: SlotState[] = [];
  /**
   * `performance.now()/1000` of the last `console.log` from the debug
   * sampler. Throttled to ~1Hz so the log isn't a firehose at 60fps.
   */
  private lastDebugLogTime = 0;

  private fft: FFTAnalyzer | null;
  private beat: BeatDetector | null;
  private midiClock: MidiClock | null;
  private midiMapping: MidiMapping | null;
  private midiManager: MidiManager | null;
  private osc: OscClient | null;

  constructor(private settings: SettingsStore, deps: ModMatrixDeps = {}) {
    this.fft = deps.fft ?? null;
    this.beat = deps.beat ?? null;
    this.midiClock = deps.midiClock ?? null;
    this.midiMapping = deps.midiMapping ?? null;
    this.midiManager = deps.midiManager ?? null;
    this.osc = deps.osc ?? null;
    this.installBaseCapture();
  }

  /** Wire a 2D pad into the joystick X/Y values (range -1..+1 per axis). */
  setJoystick(x: number, y: number, z: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
    this.joystick.z = z;
  }

  /**
   * Enable / disable mic-driven audio analysis. Backward-compat shim — the
   * actual audio routing is now driven by `settings.audioInputKind` via the
   * `AudioSection` UI, but legacy callers can still flip the mic.
   */
  async setAudioEnabled(on: boolean): Promise<void> {
    if (!this.fft) return;
    if (on) {
      try {
        await this.fft.start('mic');
        this.settings.set('audioInputKind', 'mic');
      } catch (err) {
        console.warn('mic start failed', err);
      }
    } else {
      await this.fft.stop();
      this.settings.set('audioInputKind', 'none');
    }
  }

  /** Reset all ramp generators to time zero (re-trigger). */
  retriggerRamps(): void {
    for (const s of this.slotStates) if (s) s.rampStart = null;
  }

  /**
   * Reset per-slot state for a single slot. Used by the per-row "Retrigger"
   * button to manually re-arm a one-shot ramp or re-zero an LFO phase.
   */
  retriggerSlot(index: number): void {
    const s = this.ensureSlotState(index);
    s.rampStart = null;
    s.syncedPhase = 0;
    s.audioEnv = 0;
  }

  /**
   * Inspect a slot's MIDI-clock sync state. Used by the UI to show the
   * "no clock" badge when a slot is set to MIDI sync but no clock pulses
   * are arriving. Returns null if the slot isn't in MIDI sync mode.
   */
  slotMidiClockState(index: number): { receiving: boolean; lastHz: number } | null {
    const slot = this.settings.get('modSlots')[index];
    if (!slot || slot.syncMode !== 'midi') return null;
    return {
      receiving: !!(this.midiClock && this.midiClock.receiving),
      lastHz: this.slotStates[index]?.lastSyncedHz ?? 0,
    };
  }

  /** Step the matrix; called every frame. */
  tick(dtSec: number): void {
    const now = performance.now() / 1000 - this.startTime;
    const slots = this.settings.get('modSlots');
    const internalBpm = this.settings.get('internalBpm');
    const safeDt = Math.max(0, Math.min(0.5, dtSec));

    const sums = new Map<ModTarget, number>();
    const slotValues = new Array<number>(slots.length);
    const debug = debugLogEnabled();
    const wantSample = debug && (now - this.lastDebugLogTime) >= 1.0;
    const rawValues = wantSample ? new Array<number>(slots.length) : null;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.enabled || slot.target === 'none') {
        slotValues[i] = 0;
        if (rawValues) rawValues[i] = 0;
        continue;
      }
      const state = this.ensureSlotState(i);
      const raw = this.computeSlotRaw(slot, i, state, now, safeDt, internalBpm);
      const shaped = applyOutputStage(raw, slot);
      slotValues[i] = shaped;
      if (rawValues) rawValues[i] = raw;
      const t = slot.target;
      sums.set(t, (sums.get(t) ?? 0) + shaped * slot.amount);
    }

    if (wantSample && rawValues) {
      this.lastDebugLogTime = now;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.enabled || slot.target === 'none') continue;
        // eslint-disable-next-line no-console
        console.log(
          `[ModMatrix] slot ${i} src=${slot.source} tgt=${slot.target}`,
          'raw:', rawValues[i].toFixed(4),
          'staged:', slotValues[i].toFixed(4),
          'amount:', slot.amount.toFixed(3),
          'final:', (slotValues[i] * slot.amount).toFixed(4),
        );
      }
    }

    this.writingFromTick = true;
    try {
      for (const [target, sum] of sums) {
        const base = this.bases.get(target);
        if (base == null) continue;
        const next = base + sum;
        this.settings.set(target as keyof Settings, next as never);
      }
    } finally {
      this.writingFromTick = false;
    }

    // MIDI-out: emit each enabled slot's value (-1..1 -> 0..1) as CC.
    if (this.midiManager) {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (!slot.midiOutEnabled || !slot.enabled) continue;
        const v01 = (slotValues[i] + 1) * 0.5;
        this.midiManager.sendCC(slot.midiOutChannel, slot.midiOutCC, v01);
      }
    }

    activeTargetsBus.publish('classic', new Set(sums.keys()));
  }

  // -------------------- generator math --------------------

  /**
   * Compute the raw source value for a slot, before the output stage and
   * before multiplying by `amount`. Range is -1..+1 for bipolar sources
   * and 0..+1 for unipolar (LFO with `lfoUnipolar`, audio, beat).
   */
  private computeSlotRaw(
    slot: ModSlot,
    index: number,
    state: SlotState,
    now: number,
    dt: number,
    internalBpm: number,
  ): number {
    switch (slot.source) {
      // --- Waveforms / LFOs ---
      case 'sine':
      case 'triangle':
      case 'square':
      case 'saw':
      case 'pulse': {
        const v = this.computeLfo(slot, state, now, dt, internalBpm);
        const depth = clamp01(slot.lfoDepth);
        const scaled = v * depth;
        return slot.lfoUnipolar ? (scaled + 1) * 0.5 : scaled;
      }

      // --- Ramp ---
      case 'ramp': {
        if (slot.rampHold) return slot.rampPosition * 2 - 1;
        if (state.rampStart == null) state.rampStart = now;
        const dur = Math.max(0.016, slot.rampTimeSec);
        let p = (now - state.rampStart) / dur;
        if (p > 1) {
          if (slot.rampLoop) {
            if (slot.rampMode === 'triangle') {
              p = p % 2;
              if (p > 1) p = 2 - p;
            } else {
              p = ((now - state.rampStart) % dur) / dur;
            }
          } else {
            // One-shot: clamp to end value.
            p = slot.rampMode === 'triangle' ? 0 : 1;
          }
        }
        let v: number;
        if (slot.rampMode === 'down') v = 1 - p;
        else if (slot.rampMode === 'triangle') v = p;
        else v = p;
        return v * 2 - 1;
      }

      // --- Audio sources (per-slot attack/release follower) ---
      case 'audio': {
        const target = this.fft ? this.fft.getEnvelope() : 0;
        return this.shapeAudio(slot, state, target, dt) * 2 - 1;
      }
      case 'audioBand': {
        if (!this.fft) return 0;
        const idx = Math.max(0, Math.min(this.fft.bands.length - 1, slot.bandIndex | 0));
        const target = this.fft.bands[idx];
        return this.shapeAudio(slot, state, target, dt) * 2 - 1;
      }
      case 'beat': {
        return (this.beat?.pulse ?? 0) * 2 - 1;
      }

      // --- MIDI sources ---
      case 'midiClock': {
        const c = this.midiClock;
        if (!c) return 0;
        return Math.sin(2 * Math.PI * c.phase01);
      }
      case 'midiCC': {
        if (!this.midiMapping) return 0;
        const bindings = this.settings.get('midiBindings');
        for (const b of bindings) {
          if (b.type === 'cc' || b.type === 'cc14') {
            return this.midiMapping.getLast(b.id) * 2 - 1;
          }
        }
        return 0;
      }
      case 'midiNote': {
        if (!this.midiMapping) return 0;
        let last = -1;
        for (let ch = 1; ch <= 16; ch++) {
          const p = this.midiMapping.getPoly(ch);
          if (p.lastNote != null) last = Math.max(last, p.lastNote);
        }
        return last < 0 ? 0 : (last / 127) * 2 - 1;
      }
      case 'midiVelocity': {
        if (!this.midiMapping) return 0;
        let v = 0;
        for (let ch = 1; ch <= 16; ch++) {
          v = Math.max(v, this.midiMapping.getPoly(ch).lastVelocity);
        }
        return (v / 127) * 2 - 1;
      }

      // --- OSC ---
      case 'osc': {
        if (!this.osc) return 0;
        return this.osc.getMostRecent() * 2 - 1;
      }

      // --- Joystick (per-slot smoothing / deadzone / invert) ---
      case 'joystickX':
        return this.shapeJoystick(slot, state, this.joystick.x, 'x', dt);
      case 'joystickY':
        return this.shapeJoystick(slot, state, this.joystick.y, 'y', dt);
      case 'joystickZ':
        return this.shapeJoystick(slot, state, this.joystick.z, 'z', dt);

      // --- Constant ---
      case 'constant':
        return clamp(slot.constantValue, -1, 1);
    }
    // Exhaustive check — TS will error here if a new ModSource is added
    // without a matching case (intentional safety net).
    void index;
    const _exhaustive: never = slot.source;
    return _exhaustive;
  }

  /**
   * Compute a free-running or sync-locked LFO sample in -1..+1.
   */
  private computeLfo(
    slot: ModSlot,
    state: SlotState,
    now: number,
    dt: number,
    internalBpm: number,
  ): number {
    const kind = slot.source as WaveformKind;
    let phase01: number;

    switch (slot.syncMode) {
      case 'midi': {
        if (this.midiClock && this.midiClock.receiving) {
          // Locked to live MIDI clock — use its phase directly so the LFO
          // re-anchors at every beat (drift-free).
          phase01 = this.midiClock.divisionPhase(slot.clockDivision);
          state.lastSyncedHz = this.midiClock.divisionToHz(slot.clockDivision);
          state.syncedPhase = phase01;
        } else {
          // No clock — HOLD at last known rate. We integrate locally so
          // the waveform doesn't freeze, but we don't fall back to the
          // internal BPM (would silently mask a missing clock cable).
          if (state.lastSyncedHz > 0) {
            state.syncedPhase = (state.syncedPhase + state.lastSyncedHz * dt) % 1;
            if (state.syncedPhase < 0) state.syncedPhase += 1;
          }
          phase01 = state.syncedPhase;
        }
        break;
      }
      case 'tempo': {
        const hz = divisionToHz(slot.clockDivision, internalBpm);
        state.lastSyncedHz = hz;
        state.syncedPhase = (state.syncedPhase + hz * dt) % 1;
        if (state.syncedPhase < 0) state.syncedPhase += 1;
        phase01 = state.syncedPhase;
        break;
      }
      case 'free':
      default: {
        // Free-running: derive phase from the global wallclock so
        // changing `slot.frequency` rescales smoothly without a jump
        // (matches v7 behavior).
        phase01 = (slot.frequency * now) % 1;
        if (phase01 < 0) phase01 += 1;
        break;
      }
    }

    return waveform(kind, phase01 + slot.phase, slot.duty);
  }

  /** Per-slot envelope follower with attack/release ms, gain, floor. */
  private shapeAudio(slot: ModSlot, state: SlotState, target: number, dt: number): number {
    const targetGated = target < slot.audioFloor ? 0 : target;
    const tauMs = targetGated > state.audioEnv ? slot.audioAttackMs : slot.audioReleaseMs;
    const tauSec = Math.max(0.001, tauMs / 1000);
    // 1-pole filter: y += dy * (1 - exp(-dt/tau)).
    const k = 1 - Math.exp(-dt / tauSec);
    state.audioEnv += (targetGated - state.audioEnv) * k;
    return clamp01(state.audioEnv * slot.audioGain);
  }

  /** Per-slot joystick shaping: smoothing + deadzone + invert. */
  private shapeJoystick(
    slot: ModSlot,
    state: SlotState,
    raw: number,
    axis: 'x' | 'y' | 'z',
    dt: number,
  ): number {
    const tauMs = Math.max(0, slot.joystickSmoothMs);
    let prev: number;
    if (axis === 'x') prev = state.joystickX;
    else if (axis === 'y') prev = state.joystickY;
    else prev = state.joystickZ;

    let smoothed: number;
    if (tauMs <= 0) {
      smoothed = raw;
    } else {
      const tauSec = tauMs / 1000;
      const k = 1 - Math.exp(-dt / tauSec);
      smoothed = prev + (raw - prev) * k;
    }
    if (axis === 'x') state.joystickX = smoothed;
    else if (axis === 'y') state.joystickY = smoothed;
    else state.joystickZ = smoothed;

    // Deadzone: zero values within ±deadzone (after smoothing).
    let v = Math.abs(smoothed) < slot.joystickDeadzone ? 0 : smoothed;
    if (slot.joystickInvert) v = -v;
    return clamp(v, -1, 1);
  }

  private ensureSlotState(i: number): SlotState {
    if (!this.slotStates[i]) this.slotStates[i] = makeSlotState();
    return this.slotStates[i];
  }

  /**
   * Watch for the user changing a target value to update our base — but
   * only if the change isn't coming from our own `tick()` write.
   */
  private installBaseCapture(): void {
    this.settings.subscribe('modSlots', (slots) => {
      const targets = new Set<ModTarget>();
      for (const s of slots) if (s.enabled && s.target !== 'none') targets.add(s.target);
      for (const t of targets) {
        if (!this.bases.has(t)) {
          const v = this.settings.get(t as keyof Settings) as unknown;
          if (typeof v === 'number') this.bases.set(t, v);
        }
        this.subscribeBase(t);
      }
    });
  }

  private subscribeBase(target: ModTarget): void {
    if (this.baseSubscribed.has(target)) return;
    this.baseSubscribed.add(target);
    this.settings.subscribe(target as keyof Settings, (v) => {
      if (this.writingFromTick) return;
      if (typeof v === 'number') this.bases.set(target, v);
    });
  }

  /** Force-refresh the base value for a target (called from UI on user edit). */
  recaptureBase(target: ModTarget): void {
    const v = this.settings.get(target as keyof Settings) as unknown;
    if (typeof v === 'number') this.bases.set(target, v);
  }

  /** Read-only access to the MIDI clock dependency (for UI badges). */
  getMidiClock(): MidiClock | null {
    return this.midiClock;
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

type WaveformKind = 'sine' | 'triangle' | 'square' | 'saw' | 'pulse';

/** Phase-based waveform sample in -1..+1. `phase01` is wrapped to [0,1). */
function waveform(kind: WaveformKind, phase01: number, duty: number): number {
  const t = ((phase01 % 1) + 1) % 1;
  switch (kind) {
    case 'sine':     return Math.sin(2 * Math.PI * t);
    case 'triangle': return 4 * Math.abs(t - 0.5) - 1;
    case 'square':   return t < 0.5 ? 1 : -1;
    case 'saw':      return t * 2 - 1;
    case 'pulse':    return t < duty ? 1 : -1;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Re-export the union for outside callers that still want to enumerate
// the legacy waveform/clock-division strings. (Kept for source parity
// with v7; new code should import directly from `state/Settings`.)
export type { ClockDivision };
