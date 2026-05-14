/**
 * Multi-channel CV reader for DC-coupled audio interfaces.
 *
 * Spec lives in the v9 voltage-control plan (Route A). The browser can't
 * read analog voltages directly; instead, modular Eurorack-style CVs
 * arrive through a DC-coupled audio interface (Expert Sleepers ES-8/9,
 * MOTU UltraLite, some Focusrite Scarletts) as `getUserMedia` audio
 * channels. We read those channels via an `AudioWorkletNode`, downsample
 * to control rate (1kHz typical), apply per-channel calibration +
 * smoothing + range mapping, and expose the result as scalar values.
 *
 * Emits no audio — this is a "tap" on the input. The audio-rate path
 * (for FM-style audio-rate modulation) is exposed separately via
 * `getRawAudioNode()` for code that wants to chain its own processing.
 *
 * Lifecycle:
 *
 *   1. `start({ deviceId, channelCount })` — opens `getUserMedia` with
 *      the requested device and channel constraints, instantiates the
 *      AudioWorklet, and begins receiving control-rate snapshots.
 *   2. Per channel, `setChannelConfig(i, { range, smoothMs, ... })`
 *      reconfigures the user-facing mapping. Stored in Settings.
 *   3. `getNormalized(i)` returns the latest sample mapped to -1..1
 *      (or 0..1 for unipolar). `getVoltage(i)` returns the same data
 *      mapped to volts for UI display.
 *   4. `calibrate(i)` snapshots the current raw sample as the new zero;
 *      subtracted from every subsequent read.
 *   5. `stop()` tears down the stream + worklet.
 *
 * This deliberately runs alongside `FFTAnalyzer` — a user can be using
 * channel 1 as a microphone (envelope follower) and channels 2-8 as CV
 * inputs simultaneously. The two systems don't share an `AudioContext`
 * with each other (would be feasible but adds coupling) — they each own
 * their own. Browsers happily allow multiple `getUserMedia` calls on
 * different deviceIds.
 *
 * Edge cases handled:
 *   - Device disconnected mid-session → all channel readings zero, the
 *     `running` state flips false, listeners notified. No exception.
 *   - Browser limits multi-channel input → we pick whatever count the
 *     stream actually exposes after constraints negotiation, surface
 *     it via `channelCount`, and the UI warns when it's lower than
 *     requested (Firefox is the typical culprit).
 *   - Worklet load failure → `start()` rejects with a clear error.
 */

import workletUrl from './cv-worklet.js?url';
import { CVChannel, CVPolarity, CVRange, CVControlRate, DEFAULT_CV_CHANNEL } from '../state/Settings';

export interface CVStatus {
  running: boolean;
  channelCount: number;
  deviceLabel: string;
  /** True if the browser exposed fewer channels than the user requested. */
  truncated: boolean;
  requested: number;
  /** Last error we couldn't recover from (start failure, mid-session disconnect). */
  error: string | null;
}

export type CVStatusListener = (s: CVStatus) => void;

interface SamplesMessage {
  type: 'samples';
  data: Float32Array;
  channels: number;
}

/**
 * Map a raw audio sample (-1..1, post-calibration) to volts using the
 * channel's voltage range. `±5V` maps `1.0 → +5V`, `0-5V` maps
 * `1.0 → +5V` with the centre at +2.5V, etc. Exported for tests.
 */
export function rangeFullScaleVolts(range: CVRange): number {
  switch (range) {
    case '+/-5V':  return 5;
    case '0-5V':   return 5;
    case '+/-10V': return 10;
    case '0-10V':  return 10;
  }
}

/** Map a calibrated sample (-1..1) to a normalized output respecting polarity.
 *  Exported for tests. */
export function sampleToNormalized(s: number, polarity: CVPolarity, invert: boolean): number {
  // Clamp incoming sample to the legal -1..1 range first; some interfaces
  // briefly clip on a fast voltage transient.
  let v = s;
  if (v > 1) v = 1;
  else if (v < -1) v = -1;
  if (invert) v = -v;
  if (polarity === 'unipolar') {
    // 0..1, with 0 representing the bottom of the range.
    return (v + 1) * 0.5;
  }
  return v;
}

export class CVInput {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private moduleAdded = false;

  /** Latest raw sample per channel (-1..1, pre-calibration, pre-smoothing). */
  private raw: Float32Array = new Float32Array(0);
  /** Smoothed sample per channel (post-calibration, post-smoothing, -1..1). */
  private smooth: Float32Array = new Float32Array(0);
  /** Last reported variance per channel (from the worklet). */
  private variance: Float32Array = new Float32Array(0);
  /** Time of the latest `samples` message; used to detect "no data" stalls. */
  private lastSampleAt = 0;

  /** Per-channel config — the source of truth lives in Settings; this
   *  is a local copy that the engine can read at audio-rate cost-free. */
  private configs: CVChannel[] = [];

  private listeners = new Set<CVStatusListener>();
  private status: CVStatus = {
    running: false,
    channelCount: 0,
    deviceLabel: '',
    truncated: false,
    requested: 0,
    error: null,
  };

  /** True after `start()` succeeded; toggled false on stop or device lost. */
  get running(): boolean { return this.status.running; }
  get channelCount(): number { return this.status.channelCount; }

  subscribe(fn: CVStatusListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  /**
   * Open `getUserMedia` on `deviceId` requesting `channelCount` audio
   * channels and start the worklet. Resolves once the worklet is
   * receiving samples (or rejects if the device / browser denies the
   * request). Stops any prior stream first.
   */
  async start(opts: { deviceId: string; channelCount: number }): Promise<void> {
    await this.stop();

    const requested = Math.max(1, Math.min(32, opts.channelCount | 0 || 8));
    this.setStatus({ ...this.status, requested, error: null });

    let stream: MediaStream;
    try {
      const constraints: MediaStreamConstraints = {
        video: false,
        audio: {
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
          // DC-coupled CV must NOT have any of these — they'd actively
          // destroy the signal. Eurorack CV is "loud" (often ±5V is
          // multiple full-scale audio peaks) so AGC would fight us.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Chrome honors `channelCount` for multi-channel capture from
          // pro interfaces. Firefox often clamps to 2 — we detect and
          // surface that via `truncated`.
          channelCount: { ideal: requested },
          // Some interfaces lock to a specific sample rate; let them
          // negotiate rather than hard-pinning.
          sampleRate: { ideal: 48000 },
        } as MediaTrackConstraints,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      const msg = explainMediaError(err);
      this.setStatus({ ...this.status, running: false, error: msg });
      throw new Error(msg);
    }
    this.stream = stream;

    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    const negotiatedChannels =
      (settings as { channelCount?: number }).channelCount ?? requested;
    const deviceLabel = track?.label ?? '';

    // Detect mid-session disconnect (cable yanked, interface powered off).
    track?.addEventListener('ended', () => {
      // Don't crash — zero buffers + mark not running. Engines that
      // were reading CV will see 0V on every channel, which collapses
      // to live=base via the LiveValuesStore "no stickiness" guarantee.
      this.zeroAll();
      this.setStatus({
        ...this.status,
        running: false,
        error: 'Audio interface disconnected.',
      });
    });

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (!this.moduleAdded) {
      try {
        await ctx.audioWorklet.addModule(workletUrl);
        this.moduleAdded = true;
      } catch (err) {
        await this.stop();
        throw new Error(`Failed to load CV worklet: ${(err as Error).message}`);
      }
    }

    const src = ctx.createMediaStreamSource(stream);
    this.source = src;

    // The worklet expects a fixed number of input channels. We pass
    // it the actual stream channel count via constructor options; the
    // graph in Web Audio handles the channel routing.
    const node = new AudioWorkletNode(ctx, 'cv-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1], // silent output, but Web Audio requires >= 1
      channelCount: negotiatedChannels,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    });
    this.worklet = node;
    node.port.onmessage = (e: MessageEvent<SamplesMessage>) => {
      if (e.data?.type !== 'samples') return;
      this.handleSnapshot(e.data);
    };

    src.connect(node);
    // Output is silent — but we still need to "pull" the worklet's
    // output for `process()` to be invoked at all. Connect through a
    // muted GainNode to destination; the user hears nothing.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);

    // Initial channel buffers. Configs may grow in `setChannelConfig`.
    this.raw = new Float32Array(negotiatedChannels);
    this.smooth = new Float32Array(negotiatedChannels);
    this.variance = new Float32Array(negotiatedChannels);
    while (this.configs.length < negotiatedChannels) {
      this.configs.push({ ...DEFAULT_CV_CHANNEL });
    }

    this.setStatus({
      running: true,
      channelCount: negotiatedChannels,
      deviceLabel,
      truncated: negotiatedChannels < requested,
      requested,
      error: null,
    });
  }

  async stop(): Promise<void> {
    if (this.worklet) {
      try { this.worklet.port.onmessage = null; } catch { /* noop */ }
      try { this.worklet.disconnect(); } catch { /* noop */ }
      this.worklet = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch { /* noop */ }
      this.source = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* noop */ }
      this.ctx = null;
    }
    this.zeroAll();
    this.setStatus({ ...this.status, running: false, channelCount: 0, deviceLabel: '' });
  }

  /** Replace this channel's config (range, polarity, smoothing, etc.). */
  setChannelConfig(channel: number, cfg: Partial<CVChannel>): void {
    while (this.configs.length <= channel) this.configs.push({ ...DEFAULT_CV_CHANNEL });
    this.configs[channel] = { ...this.configs[channel], ...cfg };
    // Re-push the worklet config if controlRate changed. The worklet is
    // global (one rate for all channels) so we pick the lowest control
    // rate any active channel is asking for, to give every channel the
    // resolution it needs.
    if (cfg.controlRate !== undefined) this.republishWorkletConfig();
  }

  /** Replace ALL configs in one shot. Called by `Settings.subscribe('cvChannels', ...)`. */
  setChannelConfigs(configs: CVChannel[]): void {
    this.configs = configs.map((c) => ({ ...DEFAULT_CV_CHANNEL, ...c }));
    this.republishWorkletConfig();
  }

  /**
   * Capture the current raw sample as the new zero offset for `channel`.
   * Stored on the config (so it persists in Settings on save/load) AND
   * applied immediately. If `channel` is out of range, no-op.
   */
  calibrate(channel: number): number {
    if (channel < 0 || channel >= this.raw.length) return 0;
    const offset = this.raw[channel];
    this.setChannelConfig(channel, { offset });
    return offset;
  }

  resetCalibration(channel: number): void {
    if (channel < 0 || channel >= this.configs.length) return;
    this.setChannelConfig(channel, { offset: 0 });
  }

  /**
   * Latest normalized value for `channel`, post-calibration, post-smoothing.
   * Bipolar channels return -1..1; unipolar return 0..1. Disabled channels
   * return 0 — engines treat them as silent CV.
   */
  getNormalized(channel: number): number {
    if (!this.status.running || channel < 0 || channel >= this.smooth.length) return 0;
    const cfg = this.configs[channel];
    if (!cfg || !cfg.enabled) return 0;
    return sampleToNormalized(this.smooth[channel], cfg.polarity, cfg.invert);
  }

  /** Latest raw audio sample (-1..1) without smoothing/calibration. */
  getRaw(channel: number): number {
    if (channel < 0 || channel >= this.raw.length) return 0;
    return this.raw[channel];
  }

  /**
   * Latest sample mapped to volts for UI display. Returns NaN when the
   * channel has never received a sample (lets the UI render "—V" so the
   * user knows the difference between "0V" and "no signal").
   */
  getVoltage(channel: number): number {
    if (channel < 0 || channel >= this.smooth.length) return NaN;
    if (this.lastSampleAt === 0) return NaN;
    const cfg = this.configs[channel] ?? DEFAULT_CV_CHANNEL;
    const fs = rangeFullScaleVolts(cfg.range);
    const calibrated = this.smooth[channel];
    if (cfg.range === '0-5V' || cfg.range === '0-10V') {
      // Sample range -1..1 maps to 0..fs volts.
      return (calibrated + 1) * 0.5 * fs;
    }
    return calibrated * fs;
  }

  /** Variance over the last ~2s window. Used by Learn to pick "the
   *  channel that just moved the most." Higher = more wiggle. */
  getVariance(channel: number): number {
    if (channel < 0 || channel >= this.variance.length) return 0;
    return this.variance[channel];
  }

  /** Returns the index of the channel with the highest variance over
   *  the last sampling window. Returns -1 if no channel has appreciable
   *  movement (`< minVariance`) — the caller should treat that as "no
   *  CV detected during the learn window". */
  pickHighestVarianceChannel(minVariance = 0.001): number {
    let best = -1;
    let bestVar = minVariance;
    for (let i = 0; i < this.variance.length; i++) {
      const cfg = this.configs[i];
      if (!cfg || !cfg.enabled) continue;
      const v = this.variance[i];
      if (v > bestVar) { bestVar = v; best = i; }
    }
    return best;
  }

  /** Snapshot of every channel's voltage. Used by the I/O panel
   *  per-frame readout. */
  snapshotVoltages(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.smooth.length; i++) out.push(this.getVoltage(i));
    return out;
  }

  // -------------------- internals --------------------

  private setStatus(next: CVStatus): void {
    this.status = next;
    for (const fn of this.listeners) fn(next);
  }

  private zeroAll(): void {
    this.raw.fill(0);
    this.smooth.fill(0);
    this.variance.fill(0);
  }

  private republishWorkletConfig(): void {
    if (!this.worklet) return;
    // Worklet runs at a single rate — pick the most demanding (highest)
    // requested rate so every channel has the resolution it asked for.
    let highest: CVControlRate = 100;
    for (const c of this.configs) {
      if (!c.enabled) continue;
      if (c.controlRate > highest) highest = c.controlRate;
    }
    try {
      this.worklet.port.postMessage({
        type: 'configure',
        controlRateHz: highest,
        varianceWindowMs: 2000,
      });
    } catch { /* noop — worklet may have just been torn down */ }
  }

  private handleSnapshot(msg: SamplesMessage): void {
    this.lastSampleAt = performance.now();
    const channels = msg.channels;
    if (this.raw.length !== channels) {
      this.raw = new Float32Array(channels);
      this.smooth = new Float32Array(channels);
      this.variance = new Float32Array(channels);
    }
    // dt is approximated from the worklet's effective control rate;
    // we don't need exact frame timing, just consistent smoothing.
    // The worklet posts at controlRateHz intervals.
    const dtMs = 1; // smoothing math assumes ~1ms ticks; close enough at 1kHz CR
    for (let c = 0; c < channels; c++) {
      const rawSample = msg.data[c];
      this.raw[c] = rawSample;
      this.variance[c] = msg.data[channels + c];

      const cfg = this.configs[c] ?? DEFAULT_CV_CHANNEL;
      const calibrated = rawSample - cfg.offset;
      const smoothMs = Math.max(0, cfg.smoothMs);
      if (smoothMs <= 0.5) {
        // No smoothing — assign directly.
        this.smooth[c] = calibrated;
      } else {
        const k = 1 - Math.exp(-dtMs / smoothMs);
        this.smooth[c] = this.smooth[c] + (calibrated - this.smooth[c]) * k;
      }
    }
  }
}

function explainMediaError(err: unknown): string {
  const name = (err as { name?: string }).name ?? '';
  const msg = (err as { message?: string }).message ?? String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Audio access blocked by the browser. Click the lock icon in the address bar → Site settings → set Microphone to "Allow", then reload.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No audio interface found at that ID — was it disconnected?';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Audio interface is in use by another app. Close other apps using it (DAW, conferencing) and retry.';
  }
  if (name === 'OverconstrainedError') {
    return 'The interface refused the requested constraints. Try fewer channels.';
  }
  return `getUserMedia failed: ${name || msg}`;
}
