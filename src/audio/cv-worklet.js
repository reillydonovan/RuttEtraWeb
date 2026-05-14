/* eslint-disable */
/**
 * AudioWorkletProcessor for CV input.
 *
 * Pulled here as plain JS so Vite can serve it directly via `?url` import.
 * AudioWorklet runs in its own realm, isolated from the main thread, so
 * we can't share TS types with it.
 *
 * The processor receives a multi-channel `MediaStreamAudioSourceNode`
 * input and forwards two things to the main thread:
 *
 *   1) A "control sample" per channel at a fixed rate — the mean of
 *      every block's samples for that channel, posted at most every
 *      `controlBlockSize` AudioContext samples (so the main thread
 *      doesn't drown in messages).
 *
 *   2) A running variance over the last ~2s window per channel. The
 *      "CV Learn" feature uses the highest-variance channel as the
 *      one the user just wiggled. We compute it here in the worklet
 *      so it stays accurate even when the main thread is jankily
 *      busy with rendering.
 *
 * Configuration is sent from the main thread via `port.postMessage`:
 *
 *   { type: 'configure', controlRateHz: 1000, varianceWindowMs: 2000 }
 *
 * The processor's audio output is left silent — this is a sink, not
 * a generator. (The user can still tap a separate `AnalyserNode` for
 * audio-rate use cases; the worklet's job is the control-rate path.)
 */

class CVProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** How many AudioContext samples between control-rate emits.
     *  At 48kHz: 48 → ~1kHz, 480 → 100Hz, 1 → audio rate (every block). */
    this.controlBlockSize = 48; // default ~1kHz

    /** Samples we've accumulated since the last post for the running mean. */
    this.acc = null;       // Float32Array(channels) running sum
    this.accCount = 0;     // sample count since last emit

    /** Running variance state per channel. Welford-style; we maintain
     *  mean + sum-of-squared-diffs over a rolling window. The window
     *  is approximated by exponential decay rather than a literal ring
     *  buffer (cheaper and good enough for "did this channel move a
     *  lot in the last 2 seconds"). */
    this.var_mean = null;   // Float32Array(channels)
    this.var_m2 = null;     // Float32Array(channels)
    this.var_n = 0;
    this.varDecay = 1 - Math.exp(-1 / (sampleRate * 2)); // ~2s time constant

    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'configure') {
        if (typeof m.controlRateHz === 'number' && m.controlRateHz > 0) {
          // Round to nearest sample count; clamp to [1, sampleRate].
          const n = Math.max(1, Math.min(sampleRate, Math.round(sampleRate / m.controlRateHz)));
          this.controlBlockSize = n;
        }
        if (typeof m.varianceWindowMs === 'number' && m.varianceWindowMs > 0) {
          const winSec = m.varianceWindowMs / 1000;
          this.varDecay = 1 - Math.exp(-1 / (sampleRate * winSec));
        }
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channels = input.length;

    if (!this.acc || this.acc.length !== channels) {
      this.acc = new Float32Array(channels);
      this.var_mean = new Float32Array(channels);
      this.var_m2 = new Float32Array(channels);
      this.var_n = 0;
      this.accCount = 0;
    }

    const blockLen = input[0].length;

    for (let i = 0; i < blockLen; i++) {
      for (let c = 0; c < channels; c++) {
        const s = input[c][i];
        // Running sum for control-rate downsample.
        this.acc[c] += s;
        // Running variance (decayed-window approximation).
        const diff = s - this.var_mean[c];
        this.var_mean[c] += diff * this.varDecay;
        const diff2 = s - this.var_mean[c];
        this.var_m2[c] = this.var_m2[c] * (1 - this.varDecay) + diff * diff2 * this.varDecay;
      }
      this.accCount++;

      if (this.accCount >= this.controlBlockSize) {
        // Build a flat Float32Array snapshot:
        //   [c0_mean, c1_mean, ..., c0_var, c1_var, ...]
        const snap = new Float32Array(channels * 2);
        const inv = 1 / this.accCount;
        for (let c = 0; c < channels; c++) {
          snap[c] = this.acc[c] * inv;
          snap[channels + c] = this.var_m2[c];
          this.acc[c] = 0;
        }
        this.accCount = 0;
        // Float32Arrays are transferable in modern browsers; copy is
        // cheap at this size (<1KB) so we just postMessage.
        this.port.postMessage({ type: 'samples', data: snap, channels });
      }
    }

    return true;
  }
}

registerProcessor('cv-processor', CVProcessor);
