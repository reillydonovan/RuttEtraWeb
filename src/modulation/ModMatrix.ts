/**
 * Modulation matrix — emulates the original Rutt/Etra modular components:
 * Ramp Generator, Waveform Generator (sine/tri/square/saw/pulse with duty),
 * Audio Interface (mic envelope follower), and Joystick.
 *
 * Each frame, every enabled slot computes a value in [-1, +1] and is summed
 * (per the hardware Summing Amplifier behavior) into the corresponding base
 * value of its target Settings parameter, scaled by `amount`.
 *
 * The base (un-modulated) value of each target is captured the first time
 * that target appears in any slot so modulation is additive on top of the
 * user-set value rather than overwriting it.
 */

import { ModSlot, ModTarget, Settings, SettingsStore } from '../state/Settings';

interface JoystickState {
  x: number; y: number; z: number;
}

export class ModMatrix {
  private startTime = performance.now() / 1000;
  private rampStarts = new Map<number, number>(); // slot index -> start time
  private bases = new Map<ModTarget, number>();
  private joystick: JoystickState = { x: 0, y: 0, z: 0 };
  private audioLevel = 0;
  private audioFollower: AudioFollower | null = null;

  constructor(private settings: SettingsStore) {
    this.installBaseCapture();
  }

  /** Wire a 2D pad into the joystick X/Y values (range -1..+1 per axis). */
  setJoystick(x: number, y: number, z: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
    this.joystick.z = z;
  }

  /** Enable / disable mic-driven audio follower. */
  async setAudioEnabled(on: boolean): Promise<void> {
    if (on && !this.audioFollower) {
      this.audioFollower = new AudioFollower();
      await this.audioFollower.start();
    } else if (!on && this.audioFollower) {
      this.audioFollower.stop();
      this.audioFollower = null;
      this.audioLevel = 0;
    }
  }

  /** Reset all ramp generators to time zero (re-trigger). */
  retriggerRamps(): void {
    this.rampStarts.clear();
  }

  /** Step the matrix; called every frame. */
  tick(dtSec: number): void {
    if (this.audioFollower) {
      this.audioLevel = this.audioFollower.read();
    }

    const now = performance.now() / 1000 - this.startTime;
    const slots = this.settings.get('modSlots');

    // Aggregate per-target sums
    const sums = new Map<ModTarget, number>();

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.enabled || slot.target === 'none') continue;
      const v = this.computeSlot(slot, i, now);
      const t = slot.target;
      sums.set(t, (sums.get(t) ?? 0) + v * slot.amount);
    }

    // Apply: target value = base + sum
    for (const [target, sum] of sums) {
      const base = this.bases.get(target);
      if (base == null) continue;
      const next = base + sum;
      this.settings.set(target as keyof Settings, next as any);
    }

    // For targets that *had* a base captured but no longer have any slot
    // routed to them, restore the base so we don't leave stale modulation.
    for (const [target, base] of this.bases) {
      if (!sums.has(target)) {
        const cur = this.settings.get(target as keyof Settings) as unknown as number;
        if (typeof cur === 'number' && Math.abs(cur - base) < 1e-6) continue;
        // Don't auto-restore — the user might have edited it. We leave it alone.
      }
    }
  }

  // -------------------- generator math --------------------

  private computeSlot(slot: ModSlot, index: number, now: number): number {
    switch (slot.source) {
      case 'sine':     return Math.sin(2 * Math.PI * (slot.frequency * now + slot.phase));
      case 'triangle': {
        const t = (slot.frequency * now + slot.phase) % 1;
        return 4 * Math.abs(t - 0.5) - 1;
      }
      case 'square': {
        const t = (slot.frequency * now + slot.phase) % 1;
        return t < 0.5 ? 1 : -1;
      }
      case 'saw': {
        const t = ((slot.frequency * now + slot.phase) % 1 + 1) % 1;
        return t * 2 - 1;
      }
      case 'pulse': {
        const t = ((slot.frequency * now + slot.phase) % 1 + 1) % 1;
        return t < slot.duty ? 1 : -1;
      }
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
      case 'audio':     return this.audioLevel * 2 - 1;
      case 'joystickX': return this.joystick.x;
      case 'joystickY': return this.joystick.y;
      case 'joystickZ': return this.joystick.z;
    }
  }

  /**
   * Watch for the user changing a target value to update our base —
   * but only if the change is not coming from us (we set values during tick).
   * To distinguish, we capture the value just before applying mod, so any
   * external change between ticks becomes the new base.
   */
  private installBaseCapture(): void {
    // Capture base whenever a slot's target changes to something new.
    this.settings.subscribe('modSlots', (slots) => {
      const targets = new Set<ModTarget>();
      for (const s of slots) if (s.enabled && s.target !== 'none') targets.add(s.target);
      for (const t of targets) {
        if (!this.bases.has(t)) {
          const v = this.settings.get(t as keyof Settings) as unknown;
          if (typeof v === 'number') this.bases.set(t, v);
        }
      }
    });

    // For numeric target changes that originate from outside the matrix,
    // we re-capture the base. A simple heuristic: subscribe to all and,
    // when a target value changes by more than the last applied modulation
    // delta, treat it as a user edit. To keep it simple, we re-snapshot
    // when the user edits the slot definition (above) and also expose
    // an explicit `recaptureBase(target)` for the UI to call.
  }

  /** Force-refresh the base value for a target (called from UI on user edit). */
  recaptureBase(target: ModTarget): void {
    const v = this.settings.get(target as keyof Settings) as unknown;
    if (typeof v === 'number') this.bases.set(target, v);
  }
}

// -------------------------------------------------------------------------
// Audio envelope follower — emulates the original "Audio Interface" module.
// -------------------------------------------------------------------------
class AudioFollower {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Uint8Array | null = null;
  private level = 0;
  private attack = 0.4;   // smoothing up
  private release = 0.06; // smoothing down

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    this.analyser = analyser;
    this.buffer = new Uint8Array(analyser.frequencyBinCount);
  }

  stop(): void {
    this.analyser?.disconnect();
    this.analyser = null;
    this.ctx?.close();
    this.ctx = null;
    this.buffer = null;
  }

  read(): number {
    if (!this.analyser || !this.buffer) return 0;
    this.analyser.getByteTimeDomainData(this.buffer as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const v = (this.buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buffer.length);
    const target = Math.min(1, rms * 4);
    const k = target > this.level ? this.attack : this.release;
    this.level += (target - this.level) * k;
    return this.level;
  }
}
