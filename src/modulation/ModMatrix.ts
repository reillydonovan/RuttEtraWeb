/**
 * Modulation matrix — emulates the original Rutt/Etra modular components:
 * Ramp Generator, Waveform Generator (sine/tri/square/saw/pulse with duty),
 * Audio Interface (mic envelope follower), and Joystick.
 *
 * v2 extensions:
 *   - The legacy `AudioFollower` is replaced by `FFTAnalyzer` (drop-in via
 *     `getEnvelope()`), and new `audioBand` / `beat` sources read the
 *     analyzer + beat detector directly.
 *   - MIDI sources (`midiCC`, `midiNote`, `midiVelocity`, `midiClock`) read
 *     from the `MidiMapping` / `MidiClock` last-value caches.
 *   - `osc` source reads from the `OscClient` last-value cache.
 *   - When `slot.clockSync` is true and the source is a waveform, the slot's
 *     frequency is overridden by `MidiClock.divisionToHz(slot.clockDivision)`.
 *   - When `slot.midiOutEnabled` is set, the post-modulation slot value is
 *     emitted as a CC message on the chosen MIDI output.
 *
 * Each frame, every enabled slot computes a value in [-1, +1] and is summed
 * into the base value of its target Settings parameter, scaled by `amount`.
 */

import { ModSlot, ModTarget, Settings, SettingsStore } from '../state/Settings';
import { FFTAnalyzer } from '../audio/FFTAnalyzer';
import { BeatDetector } from '../audio/BeatDetector';
import { MidiClock } from '../midi/MidiClock';
import { MidiManager } from '../midi/MidiManager';
import { MidiMapping } from '../midi/MidiMapping';
import { OscClient } from '../osc/OscClient';
import { activeTargetsBus } from './ActiveTargetsBus';

interface JoystickState {
  x: number; y: number; z: number;
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
  private rampStarts = new Map<number, number>(); // slot index -> start time
  private bases = new Map<ModTarget, number>();
  /** Targets we've already wired a `subscribe()` listener on (so we don't double-subscribe). */
  private baseSubscribed = new Set<ModTarget>();
  /**
   * True while `tick()` is writing values back to `Settings`. Used by the
   * base-capture subscription to ignore self-writes (otherwise every tick
   * would overwrite the base with `base + sum`, defeating the purpose).
   */
  private writingFromTick = false;
  private joystick: JoystickState = { x: 0, y: 0, z: 0 };

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
    this.rampStarts.clear();
  }

  /** Step the matrix; called every frame. */
  tick(_dtSec: number): void {
    const now = performance.now() / 1000 - this.startTime;
    const slots = this.settings.get('modSlots');

    const sums = new Map<ModTarget, number>();
    const slotValues = new Array<number>(slots.length);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.enabled || slot.target === 'none') {
        slotValues[i] = 0;
        continue;
      }
      const v = this.computeSlot(slot, i, now);
      slotValues[i] = v;
      const t = slot.target;
      sums.set(t, (sums.get(t) ?? 0) + v * slot.amount);
    }

    this.writingFromTick = true;
    try {
      for (const [target, sum] of sums) {
        const base = this.bases.get(target);
        if (base == null) continue;
        const next = base + sum;
        this.settings.set(target as keyof Settings, next as any);
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

    // Publish the set of params we wrote so the dual-engine indicator
    // in widgets.ts can show / hide its dot.
    activeTargetsBus.publish('classic', new Set(sums.keys()));
  }

  // -------------------- generator math --------------------

  private computeSlot(slot: ModSlot, index: number, now: number): number {
    // Clock-sync override for waveform sources: use BPM-derived Hz and phase.
    if (slot.clockSync && this.midiClock && isWaveform(slot.source)) {
      const hz = this.midiClock.divisionToHz(slot.clockDivision);
      const ph = this.midiClock.divisionPhase(slot.clockDivision);
      return waveform(slot.source as WaveformKind, hz, ph + slot.phase, slot.duty, now, /*useExternalPhase*/ true);
    }

    switch (slot.source) {
      case 'sine':
      case 'triangle':
      case 'square':
      case 'saw':
      case 'pulse':
        return waveform(slot.source as WaveformKind, slot.frequency, slot.phase, slot.duty, now, false);

      case 'ramp': {
        let start = this.rampStarts.get(index);
        if (start == null) { start = now; this.rampStarts.set(index, start); }
        if (slot.rampHold) {
          return slot.rampPosition * 2 - 1;
        }
        const dur = Math.max(0.016, slot.rampTimeSec);
        let p = (now - start) / dur;
        if (p > 1) {
          if (slot.rampMode === 'triangle') {
            p = p % 2;
            if (p > 1) p = 2 - p;
          } else {
            p = ((now - start) % dur) / dur;
          }
        }
        let v: number;
        if (slot.rampMode === 'down') v = 1 - p;
        else if (slot.rampMode === 'triangle') v = p;
        else v = p;
        return v * 2 - 1;
      }

      case 'audio': {
        const env = this.fft ? this.fft.getEnvelope() : 0;
        return env * 2 - 1;
      }
      case 'audioBand': {
        if (!this.fft) return 0;
        const idx = Math.max(0, Math.min(this.fft.bands.length - 1, slot.bandIndex | 0));
        return this.fft.bands[idx] * 2 - 1;
      }
      case 'beat': {
        return (this.beat?.pulse ?? 0) * 2 - 1;
      }

      case 'midiClock': {
        const c = this.midiClock;
        if (!c) return 0;
        // Map phase 0..1 (one quarter note) to a -1..+1 sine for smooth use,
        // unless the slot uses clockSync (in which case the wave path above
        // already runs). Here `midiClock` is a standalone source.
        return Math.sin(2 * Math.PI * c.phase01) ;
      }
      case 'midiCC': {
        // Most-recently-touched CC binding wins; users usually have a single
        // CC bound for a given slot via Learn anyway.
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
        // Last note across all channels, normalized 0..1 (note 0 -> -1, 127 -> +1).
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

      case 'osc': {
        if (!this.osc) return 0;
        return this.osc.getMostRecent() * 2 - 1;
      }

      case 'joystickX': return this.joystick.x;
      case 'joystickY': return this.joystick.y;
      case 'joystickZ': return this.joystick.z;
    }
  }

  /**
   * Watch for the user changing a target value to update our base — but
   * only if the change isn't coming from our own `tick()` write (those are
   * gated by `writingFromTick`). External writes (slider drag, MIDI in,
   * preset apply, sequencer keyframe) update the base so that the slot's
   * additive modulation is layered on top of the new manual value rather
   * than fighting it.
   *
   * Subscribed lazily, once per target, the first time a slot routes there.
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
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

type WaveformKind = 'sine' | 'triangle' | 'square' | 'saw' | 'pulse';

function isWaveform(s: string): boolean {
  return s === 'sine' || s === 'triangle' || s === 'square' || s === 'saw' || s === 'pulse';
}

/**
 * Generate a -1..+1 waveform sample.
 *
 * If `useExternalPhase` is true, `phase` is treated as an absolute 0..1 phase
 * (already advanced by an external source like MIDI clock). Otherwise the
 * sample is computed from `freq*now + phase` (free-running).
 */
function waveform(
  kind: WaveformKind,
  freq: number,
  phase: number,
  duty: number,
  now: number,
  useExternalPhase: boolean,
): number {
  const t = useExternalPhase
    ? ((phase % 1) + 1) % 1
    : ((freq * now + phase) % 1 + 1) % 1;
  switch (kind) {
    case 'sine':     return Math.sin(2 * Math.PI * t);
    case 'triangle': return 4 * Math.abs(t - 0.5) - 1;
    case 'square':   return t < 0.5 ? 1 : -1;
    case 'saw':      return t * 2 - 1;
    case 'pulse':    return t < duty ? 1 : -1;
  }
}
