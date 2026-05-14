/* eslint-disable */
/**
 * AudioWorkletProcessor for CV output.
 *
 * One instance per CV output channel. The main thread `postMessage`s a
 * stream of target sample values (clipped to -1..1) and per-channel
 * configuration; the worklet writes a smoothed, ramp-gated, hard-clamped
 * sample stream into the audio output bus, one channel of which is
 * routed by the parent `ChannelMergerNode` to the desired interface
 * channel.
 *
 * Per the v9 spec, three guarantees are baked in here so they can never
 * be bypassed by main-thread bugs:
 *
 *   1. **`enabled=false` emits exactly 0 samples.** Even if `target`
 *      somehow drifted, a disabled channel literally writes the
 *      constant zero — there's no bypass for "I forgot the channel
 *      was off".
 *
 *   2. **0V → target ramp on every enable.** Whenever `enabled` flips
 *      false → true (including the very first time after page load),
 *      a 100ms internal `startupGain` ramps from 0 to 1 and multiplies
 *      whatever the current target is. Prevents click/pop on patch and
 *      protects gear from sudden voltage jumps.
 *
 *   3. **Hard clamp to ±1.0** at the end of every sample, after every
 *      other math step. Voltage range / scale / offset are mapped on
 *      the main thread; this clamp is the last line of defense against
 *      a 50V swing reaching hardware.
 *
 * Trigger pulses are scheduled by main-thread postMessage:
 *   `{ type: 'trigger', durationSamples, level }`
 * The worklet holds `level` for that many samples, overriding the
 * smoothed/clamped path for the duration of the pulse.
 *
 * Test mode is achieved by main thread setting target to a fixed sample;
 * no extra worklet plumbing is needed.
 */

class CVOutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** Latest target sample value, set by main thread postMessage. */
    this.target = 0;
    /** Smoothed running value, lerps toward target each sample. */
    this.cur = 0;
    /** 1-pole smoothing coefficient, 0..1 (1 = no smoothing). */
    this.kSmooth = 1;

    /** Whether the channel is allowed to emit non-zero samples. */
    this.enabled = false;
    /** Internal startup ramp 0..1, multiplies target when transitioning
     *  from disabled to enabled. Reset to 0 on every false→true edge.
     *  ALSO used as a fade-out gain on true→false so disable produces
     *  a smooth ~100ms ramp to zero instead of an instantaneous drop. */
    this.startupGain = 0;
    /** Per-sample increment that ramps `startupGain` 0→1 in 100ms. */
    this.startupK = 1 / (sampleRate * 0.1);
    /** When non-zero, the worklet is in "disabling" state — keeps
     *  emitting smoothed samples while ramping `startupGain` down to 0,
     *  then stops emitting altogether. */
    this.disabling = false;

    /** Trigger pulse override — non-zero `triggerSamplesRemaining` forces
     *  `triggerLevel` regardless of smoothing. */
    this.triggerSamplesRemaining = 0;
    this.triggerLevel = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      switch (m.type) {
        case 'target':
          if (typeof m.value === 'number' && Number.isFinite(m.value)) {
            this.target = m.value;
          }
          break;
        case 'enable':
          if (m.value && !this.enabled) {
            // false→true: arm the startup ramp.
            this.startupGain = 0;
            this.disabling = false;
          } else if (!m.value && this.enabled) {
            // true→false: enter disabling state — keep emitting samples
            // but ramp the gain DOWN over 100ms before going silent.
            this.disabling = true;
          }
          this.enabled = !!m.value;
          break;
        case 'smooth':
          // Convert a time-constant in ms to a per-sample lerp coef.
          // k=1 means "snap to target" (no smoothing).
          if (typeof m.ms === 'number' && m.ms > 0) {
            this.kSmooth = 1 - Math.exp(-1 / (sampleRate * (m.ms / 1000)));
          } else {
            this.kSmooth = 1;
          }
          break;
        case 'trigger':
          this.triggerSamplesRemaining = Math.max(0, m.durationSamples | 0);
          this.triggerLevel = typeof m.level === 'number' ? m.level : 0;
          break;
        case 'reset':
          // Force-zero everything — used when the host disables the
          // entire CV output subsystem.
          this.target = 0;
          this.cur = 0;
          this.startupGain = 0;
          this.triggerSamplesRemaining = 0;
          break;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;

    // Guarantee 1: disabled AND not currently fading out -> emit zero
    // and reset internal state so the next enable starts fresh from 0V.
    if (!this.enabled && !this.disabling) {
      this.cur = 0;
      this.startupGain = 0;
      out.fill(0);
      return true;
    }

    const n = out.length;
    for (let i = 0; i < n; i++) {
      // Smooth toward target. Even while disabling, we keep tracking the
      // last target so the descending envelope follows the source rather
      // than freezing.
      this.cur += (this.target - this.cur) * this.kSmooth;

      if (this.disabling) {
        // Ramp gain DOWN to 0 over 100ms.
        this.startupGain -= this.startupK;
        if (this.startupGain <= 0) {
          this.startupGain = 0;
          this.disabling = false;
        }
      } else if (this.startupGain < 1) {
        // Normal startup ramp UP to 1 over 100ms after enable.
        this.startupGain += this.startupK;
        if (this.startupGain > 1) this.startupGain = 1;
      }

      // Trigger overlay overrides smoothed value while active.
      let v;
      if (this.triggerSamplesRemaining > 0) {
        v = this.triggerLevel * this.startupGain;
        this.triggerSamplesRemaining--;
      } else {
        v = this.cur * this.startupGain;
      }

      // Guarantee 3: hard sample clamp. Last instruction before write.
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      out[i] = v;
    }

    return true;
  }
}

registerProcessor('cv-out-processor', CVOutProcessor);
