/**
 * MIDI clock receiver.
 *
 * The MIDI spec sends 24 clock pulses (0xF8) per quarter note. We maintain a
 * sliding window of the last N pulse arrival times to derive a smoothed BPM,
 * advance an internal phase counter (one full revolution per quarter note),
 * and expose a decaying `beatPulse` that spikes to 1.0 on each downbeat.
 *
 * Transport is tracked via the start/stop/continue real-time messages
 * (0xFA / 0xFC / 0xFB). The clock continues ticking even with no incoming
 * pulses so callers can run `tick(dt)` every frame and get a meaningful
 * `phase01` based on the last-known BPM.
 */

import { ClockDivision } from '../state/Settings';
import { divisionToHz as pureDivisionToHz, divisionToBeats } from '../modulation/tempo';

// Re-export the canonical helpers so legacy callers (e.g. ModulationSection)
// can keep importing from `midi/MidiClock`.
export { ALL_DIVISIONS, divisionToHz } from '../modulation/tempo';

const PULSES_PER_QUARTER = 24;
const PULSE_HISTORY = PULSES_PER_QUARTER * 2; // ~2 quarter notes for smoothing

export type Transport = 'stopped' | 'playing';

type Listener = (state: { bpm: number; transport: Transport }) => void;

export class MidiClock {
  /** Smoothed beats-per-minute. Defaults to 120 until pulses are seen. */
  bpm = 120;
  /** 0..1 across one quarter note. */
  phase01 = 0;
  /** 1.0 on a downbeat, decays exponentially. */
  beatPulse = 0;
  /** Transport state from start/stop/continue messages. */
  transport: Transport = 'stopped';
  /** Whether we've ever received a clock pulse this session. */
  receiving = false;

  private pulseTimes: number[] = [];
  private pulseCount = 0;
  private lastPulseAt = 0;
  private listeners = new Set<Listener>();
  private beatDecay = 6.0; // higher = faster decay

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn({ bpm: this.bpm, transport: this.transport });
    return () => this.listeners.delete(fn);
  }

  /** Process an incoming raw MIDI message. Returns true if it was a clock-related byte. */
  handle(data: Uint8Array | number[]): boolean {
    const status = data[0];
    switch (status) {
      case 0xF8: this.onPulse(); return true;
      case 0xFA: this.onStart(); return true;
      case 0xFB: this.onContinue(); return true;
      case 0xFC: this.onStop(); return true;
      default:   return false;
    }
  }

  /** Step the clock by `dt` seconds; advances phase using the current BPM. */
  tick(dt: number): void {
    if (this.transport === 'playing' && this.bpm > 0) {
      const beatsPerSec = this.bpm / 60;
      this.phase01 = (this.phase01 + beatsPerSec * dt) % 1;
    }
    if (this.beatPulse > 0) {
      this.beatPulse = Math.max(0, this.beatPulse - this.beatDecay * dt);
    }
    // If we haven't received a pulse in 2 seconds, mark as not receiving.
    if (this.receiving && performance.now() - this.lastPulseAt > 2000) {
      this.receiving = false;
      this.notify();
    }
  }

  /** Convert a clock division to Hz at the current BPM. */
  divisionToHz(div: ClockDivision): number {
    return pureDivisionToHz(div, this.bpm);
  }

  /** 0..1 phase for a given clock division (one revolution per division). */
  divisionPhase(div: ClockDivision): number {
    const beats = divisionToBeats(div);
    // phase01 is one rev per quarter; scale to the division.
    return ((this.phase01 / beats) % 1 + 1) % 1;
  }

  // -------------------- internals --------------------

  private onPulse(): void {
    const now = performance.now();
    this.lastPulseAt = now;
    this.receiving = true;
    this.pulseTimes.push(now);
    if (this.pulseTimes.length > PULSE_HISTORY) {
      this.pulseTimes.splice(0, this.pulseTimes.length - PULSE_HISTORY);
    }

    // Derive BPM from the average gap over the window.
    if (this.pulseTimes.length >= 2) {
      const span = this.pulseTimes[this.pulseTimes.length - 1] - this.pulseTimes[0];
      const gaps = this.pulseTimes.length - 1;
      const msPerPulse = span / gaps;
      // 24 pulses per quarter note. quarterNoteMs = msPerPulse * 24
      // bpm = 60000 / quarterNoteMs
      const bpm = 60_000 / (msPerPulse * PULSES_PER_QUARTER);
      // Smooth gently so BPM doesn't jitter on tempo changes.
      this.bpm = this.bpm === 0 ? bpm : this.bpm * 0.85 + bpm * 0.15;
    }

    if (this.transport === 'stopped') {
      // Some sources never send Start; treat the first pulse as transport on.
      this.transport = 'playing';
    }

    this.pulseCount++;
    if (this.pulseCount % PULSES_PER_QUARTER === 0) {
      this.beatPulse = 1.0;
      this.phase01 = 0; // re-anchor at every beat to absorb drift
      this.notify();
    } else {
      // Update phase between beats based on pulse position.
      this.phase01 = (this.pulseCount % PULSES_PER_QUARTER) / PULSES_PER_QUARTER;
    }
  }

  private onStart(): void {
    this.transport = 'playing';
    this.pulseCount = 0;
    this.phase01 = 0;
    this.beatPulse = 1.0;
    this.notify();
  }

  private onContinue(): void {
    this.transport = 'playing';
    this.notify();
  }

  private onStop(): void {
    this.transport = 'stopped';
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn({ bpm: this.bpm, transport: this.transport });
  }
}

// `divisionToHz` and `ALL_DIVISIONS` are re-exported from
// `src/modulation/tempo.ts` (see top of file). Single source of truth.
