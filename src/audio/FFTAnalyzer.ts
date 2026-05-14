/**
 * Multi-band FFT analyzer.
 *
 * Wraps a single `AnalyserNode` and groups its frequency bins into N user-
 * configurable bands using one of three spacing modes (linear / log / mel).
 *
 * Each band has its own attack/release smoothing, applied per-tick rather
 * than relying on the AnalyserNode's `smoothingTimeConstant` (which is a
 * single global IIR coefficient and not dt-aware).
 *
 * Subsumes the original `AudioFollower` from `ModMatrix.ts`: `getEnvelope()`
 * returns the weighted-mean band energy, drop-in compatible with
 * `AudioFollower.read()`. This keeps the existing `audio` ModSource working.
 *
 * Inputs:
 *   - 'mic'   — getUserMedia
 *   - 'tab'   — getDisplayMedia({audio:true})  (browsers that support it)
 *   - 'file'  — supplied later via `attachAudioElement(<audio>)`
 *   - 'none'  — no input, bands stay zeroed
 *
 * Monitor (optional, default OFF) routes the input to the destination so you
 * can hear what's being analyzed — costs feedback risk with mic input.
 */

import { BandCount, BandSpacing, FftSize } from '../state/Settings';

export type AudioInput = 'mic' | 'tab' | 'file' | 'none' | MediaStream;

export interface BandShape {
  attackMs: number;
  releaseMs: number;
  gain: number;
  floor: number;
  thresholdDb: number;
}

export interface FftAnalyzerListener {
  (s: { running: boolean; kind: string }): void;
}

export class FFTAnalyzer {
  /** Smoothed band values, one per band, in 0..1. */
  bands: Float32Array;
  /** Raw (un-smoothed) band values from the latest sample. */
  bandsRaw: Float32Array;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioNode | null = null;
  private monitorGain: GainNode | null = null;
  private mediaStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;

  private bandIndices: { lo: number; hi: number }[] = [];
  private fftBuffer: Uint8Array | null = null;     // 0..255 byte data
  private bandCount: BandCount = 32;
  private fftSize: FftSize = 2048;
  private spacing: BandSpacing = 'log';
  private shape: BandShape = { attackMs: 25, releaseMs: 180, gain: 1, floor: 0.02, thresholdDb: -90 };
  private kind: string = 'none';
  private listeners = new Set<FftAnalyzerListener>();

  constructor() {
    this.bands = new Float32Array(this.bandCount);
    this.bandsRaw = new Float32Array(this.bandCount);
  }

  get running(): boolean {
    return this.source != null;
  }

  subscribe(fn: FftAnalyzerListener): () => void {
    this.listeners.add(fn);
    fn({ running: this.running, kind: this.kind });
    return () => this.listeners.delete(fn);
  }

  // -------------------- input lifecycle --------------------

  async start(input: AudioInput): Promise<void> {
    await this.stop();
    if (input === 'none') return;

    const ctx = this.ensureContext();

    let src: AudioNode;
    let kindLabel = '';
    if (input === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.mediaStream = stream;
      src = ctx.createMediaStreamSource(stream);
      kindLabel = 'mic';
    } else if (input === 'tab') {
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: { video: boolean; audio: boolean }): Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: true });
      // Drop the video tracks — we only want the audio.
      for (const t of stream.getVideoTracks()) t.stop();
      const audioOnly = new MediaStream(stream.getAudioTracks());
      this.mediaStream = audioOnly;
      src = ctx.createMediaStreamSource(audioOnly);
      kindLabel = 'tab';
    } else if (input === 'file') {
      // Audio element is attached separately via attachAudioElement().
      // Without an element this is a no-op; it'll be wired when one arrives.
      this.kind = 'file';
      this.notify();
      return;
    } else if (input instanceof MediaStream) {
      this.mediaStream = input;
      src = ctx.createMediaStreamSource(input);
      kindLabel = 'stream';
    } else {
      throw new Error(`Unsupported input: ${String(input)}`);
    }

    this.attachSource(src);
    this.kind = kindLabel;
    this.notify();
  }

  /** Plug in an existing <audio> element (used for the 'file' input mode). */
  attachAudioElement(el: HTMLAudioElement): void {
    if (this.audioElement === el && this.elementSource) return;
    this.detachAudioElement();
    const ctx = this.ensureContext();
    this.audioElement = el;
    this.elementSource = ctx.createMediaElementSource(el);
    // For file input we always route to destination so the user hears it.
    this.elementSource.connect(ctx.destination);
    this.attachSource(this.elementSource);
    this.kind = 'file';
    this.notify();
  }

  detachAudioElement(): void {
    if (this.elementSource) {
      try { this.elementSource.disconnect(); } catch { /* noop */ }
      this.elementSource = null;
    }
    this.audioElement = null;
  }

  async stop(): Promise<void> {
    if (this.source) {
      try { this.source.disconnect(); } catch { /* noop */ }
    }
    this.source = null;
    if (this.monitorGain) {
      try { this.monitorGain.disconnect(); } catch { /* noop */ }
      this.monitorGain = null;
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
      this.mediaStream = null;
    }
    this.detachAudioElement();
    this.bands.fill(0);
    this.bandsRaw.fill(0);
    this.kind = 'none';
    this.notify();
  }

  setMonitor(on: boolean): void {
    if (!this.ctx || !this.monitorGain) return;
    this.monitorGain.gain.value = on ? 1 : 0;
  }

  // -------------------- configuration --------------------

  setFftSize(n: FftSize): void {
    if (n === this.fftSize) return;
    this.fftSize = n;
    if (this.analyser) this.analyser.fftSize = n;
    this.fftBuffer = new Uint8Array(this.analyser ? this.analyser.frequencyBinCount : n / 2);
    this.recomputeBandIndices();
  }

  setBandCount(n: BandCount): void {
    if (n === this.bandCount) return;
    this.bandCount = n;
    this.bands = new Float32Array(n);
    this.bandsRaw = new Float32Array(n);
    this.recomputeBandIndices();
  }

  setSpacing(mode: BandSpacing): void {
    if (mode === this.spacing) return;
    this.spacing = mode;
    this.recomputeBandIndices();
  }

  setBandShape(shape: Partial<BandShape>): void {
    Object.assign(this.shape, shape);
    if (this.analyser) {
      this.analyser.minDecibels = this.shape.thresholdDb;
    }
  }

  // -------------------- per-frame --------------------

  /**
   * Copy the most recent audio samples (time-domain, signed -1..1)
   * into `out`. Returns `true` if the analyser is live and `out` was
   * written; `false` otherwise. Used by the graph engine's pitch
   * tracker (`AudioFFTLike.getTimeDomain`) AND the Pattern Generator's
   * oscilloscope mode for audio-source scope traces.
   */
  getTimeDomain(out: Float32Array): boolean {
    if (!this.analyser) {
      out.fill(0);
      return false;
    }
    const fftN = this.analyser.fftSize;
    if (out.length === fftN) {
      this.analyser.getFloatTimeDomainData(out as Float32Array<ArrayBuffer>);
      return true;
    }
    const tmp = new Float32Array(fftN);
    this.analyser.getFloatTimeDomainData(tmp as Float32Array<ArrayBuffer>);
    if (out.length < fftN) {
      out.set(tmp.subarray(fftN - out.length));
    } else {
      out.fill(0);
      out.set(tmp);
    }
    return true;
  }

  /** Sample the analyser, group into bands, smooth. Call once per frame. */
  tick(dtSec: number): void {
    if (!this.analyser || !this.fftBuffer) return;
    this.analyser.getByteFrequencyData(this.fftBuffer as Uint8Array<ArrayBuffer>);

    const N = this.bandCount;
    const buf = this.fftBuffer;

    // Group bins into bands.
    for (let b = 0; b < N; b++) {
      const { lo, hi } = this.bandIndices[b];
      let sum = 0;
      let count = 0;
      for (let i = lo; i < hi; i++) {
        sum += buf[i];
        count++;
      }
      const raw = count > 0 ? (sum / count) / 255 : 0;
      this.bandsRaw[b] = raw;
    }

    // Apply attack/release smoothing per band, plus gain/floor.
    const attackK = 1 - Math.exp(-(dtSec * 1000) / Math.max(1, this.shape.attackMs));
    const releaseK = 1 - Math.exp(-(dtSec * 1000) / Math.max(1, this.shape.releaseMs));
    for (let b = 0; b < N; b++) {
      const target = this.bandsRaw[b] * this.shape.gain;
      const cur = this.bands[b];
      const k = target > cur ? attackK : releaseK;
      let next = cur + (target - cur) * k;
      if (next < this.shape.floor) next = 0;
      if (next > 1) next = 1;
      this.bands[b] = next;
    }
  }

  /** Drop-in replacement for the old AudioFollower.read(). 0..1. */
  getEnvelope(): number {
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < this.bandCount; i++) {
      // Light spectral weighting so mids matter more than highs.
      const w = 1 - i / (this.bandCount * 1.5);
      sum += this.bands[i] * w;
      weight += w;
    }
    return weight > 0 ? Math.min(1, sum / weight) : 0;
  }

  // -------------------- internals --------------------

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private attachSource(src: AudioNode): void {
    const ctx = this.ensureContext();
    this.source = src;

    // Always create a fresh analyser to handle fftSize transitions cleanly.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = this.fftSize;
    analyser.smoothingTimeConstant = 0.0; // we handle smoothing ourselves
    analyser.minDecibels = this.shape.thresholdDb;
    analyser.maxDecibels = -10;
    this.analyser = analyser;
    this.fftBuffer = new Uint8Array(analyser.frequencyBinCount);
    this.recomputeBandIndices();

    // Source -> analyser. Optional monitor goes through a gain node.
    src.connect(analyser);
    const monitor = ctx.createGain();
    monitor.gain.value = 0; // off by default
    analyser.connect(monitor);
    monitor.connect(ctx.destination);
    this.monitorGain = monitor;
  }

  private recomputeBandIndices(): void {
    if (!this.analyser) return;
    const bins = this.analyser.frequencyBinCount;
    const N = this.bandCount;
    const indices: { lo: number; hi: number }[] = [];

    if (this.spacing === 'linear') {
      for (let b = 0; b < N; b++) {
        const lo = Math.floor((b * bins) / N);
        const hi = Math.max(lo + 1, Math.floor(((b + 1) * bins) / N));
        indices.push({ lo, hi });
      }
    } else if (this.spacing === 'log') {
      const minHz = 30;
      const sampleRate = this.ctx?.sampleRate ?? 48000;
      const nyquist = sampleRate / 2;
      const minBin = Math.max(1, Math.floor((minHz * bins) / nyquist));
      const ratio = Math.log(bins / minBin) / N;
      for (let b = 0; b < N; b++) {
        const lo = Math.floor(minBin * Math.exp(b * ratio));
        const hi = Math.max(lo + 1, Math.floor(minBin * Math.exp((b + 1) * ratio)));
        indices.push({ lo, hi: Math.min(hi, bins) });
      }
    } else if (this.spacing === 'mel') {
      const sampleRate = this.ctx?.sampleRate ?? 48000;
      const nyquist = sampleRate / 2;
      const melMax = 2595 * Math.log10(1 + nyquist / 700);
      for (let b = 0; b < N; b++) {
        const m0 = (b / N) * melMax;
        const m1 = ((b + 1) / N) * melMax;
        const f0 = 700 * (Math.pow(10, m0 / 2595) - 1);
        const f1 = 700 * (Math.pow(10, m1 / 2595) - 1);
        const lo = Math.max(0, Math.floor((f0 * bins) / nyquist));
        const hi = Math.max(lo + 1, Math.floor((f1 * bins) / nyquist));
        indices.push({ lo, hi: Math.min(hi, bins) });
      }
    }

    this.bandIndices = indices;
  }

  private notify(): void {
    for (const fn of this.listeners) fn({ running: this.running, kind: this.kind });
  }
}
