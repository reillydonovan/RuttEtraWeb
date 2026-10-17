/**
 * Wraps `MediaRecorder` to capture the WebGL canvas (with optional mic
 * audio and / or sonification voice) and trigger a download when the
 * user stops.
 *
 * Two engines (record-quality audit, 2026-10-17):
 *   - WebCodecs (default, WebCodecsCapture.ts): H.264 High / VP9 / AV1 driven
 *     directly, quality-first, constant quality, locked size + frame rate.
 *     Frames are captured right after each render via `captureRenderedFrame()`.
 *   - MediaRecorder (fallback / "Compatibility"): the browser's realtime
 *     recorder. Codec preference: MP4/H.264 (High → Main → Baseline) →
 *     WebM/VP9 → WebM/VP8. Used when WebCodecs is missing or fails to start.
 *
 * Audio sources mixed into the stream:
 *   - mic (optional, via getUserMedia)
 *   - sonification voice (optional, when the synth's audible-output
 *     subsystem is enabled — captured post-master, post-limiter)
 *   - video element audio (optional, via HTMLMediaElement.captureStream)
 *
 * All three can be active simultaneously. The browser handles cross-track
 * mixing inside the MediaRecorder.
 */

import type { InjectionResult, StereoMetadataInjector } from './StereoMetadata';

/** Sonification capture interface — only what the recorder needs from
 *  `Sonification`. Kept duck-typed so tests can stub it. */
export interface SonificationCapture {
  getCaptureStream(): MediaStream | null;
}

/**
 * Video element audio capture interface — only what the recorder needs
 * from `VideoSourceManager`. Kept duck-typed so tests can stub it.
 * Returns `null` when no source is active, the API is unavailable
 * (Safari), or the active source has no audio track.
 */
export interface VideoAudioCapture {
  getCaptureStream(): MediaStream | null;
}

/**
 * Stereo recording source. Tells the recorder where to pull video
 * frames from when stereoscopic mode is engaged. The compositor's
 * lifecycle (start / stop / tick) is owned by the caller — Recorder
 * just consumes the stream and reads the output dimensions for the
 * UI status line.
 */
export interface StereoRecordingSource {
  /** MediaStream of the side-by-side composite canvas at the given fps. */
  getStream(fps: number): MediaStream;
  /** Composite-canvas width (2× per-eye width). Read for status display. */
  outputWidth(): number;
  /** Composite-canvas height. Read for status display. */
  outputHeight(): number;
  /** Prepare the offscreen canvas + cameras. Called before `MediaRecorder` starts. */
  start(eyeWidth: number, eyeHeight: number): void;
  /** End the compositor's per-frame render. Called once MediaRecorder has stopped. */
  stop(): void;
  /** The side-by-side canvas itself — lets the WebCodecs engine read it directly. */
  getCanvas?(): HTMLCanvasElement;
}

export interface RecordOptions {
  fps: number;
  bitsPerSecond?: number;
  includeMic?: boolean;
  /** Which mic (Settings.recordMicDeviceId): '' = the running camera's own mic,
   *  'default' = the system default, else a deviceId. */
  micDeviceId?: string;
  /** Bake the video element's own audio track into the recording.
   *  Independent of speaker-playback (`videoAudioEnabled` setting).
   *  No-op when the active source has no audio or `VideoAudioCapture`
   *  was not provided to the `CanvasRecorder` constructor. */
  includeVideoAudio?: boolean;
  preferredFormat?: 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
  /** 'webcodecs' (default) tries the high-quality engine first; 'mediarecorder' forces the old one. */
  engine?: 'webcodecs' | 'mediarecorder';
  /** WebCodecs rate control: constant quality (default) or the bitrate as a target. */
  rateControl?: 'quality' | 'bitrate';
  /** Optional slug prepended to the auto-generated filename (no extension). */
  filenameHint?: string;
  /**
   * Stereoscopic recording opts. When `enabled` is true, the recorder
   * sources its video track from `source.getStream(fps)` instead of
   * the main canvas's captureStream, and pipes the final blob through
   * `injectMetadata` (when MP4 is the active container).
   *
   * `source` is required when `enabled`; the typing keeps the two
   * fields linked so callers can't ask for stereo without providing
   * the compositor. `eyeWidth` / `eyeHeight` size the composite
   * canvas the recorder is reading from.
   */
  stereo?: {
    enabled: true;
    source: StereoRecordingSource;
    eyeWidth: number;
    eyeHeight: number;
    /** Inject st3d metadata into MP4 output. No effect on WebM. */
    injectMetadata: boolean;
  };
}

/**
 * Outcome of stereo metadata injection, forwarded from `injectStereoscopicMetadata`
 * to the caller's toast hook so the user can be told what happened.
 * `null` means stereo wasn't requested for this recording.
 */
export type StereoFinalizeOutcome = InjectionResult | null;

const FORMAT_CHAIN: { id: string; mime: string; ext: string }[] = [
  // High, then Main, before Constrained Baseline (42E01F) — Baseline has no CABAC,
  // B-frames or 8×8 transform and smears thin scan lines.
  { id: 'mp4',      mime: 'video/mp4;codecs=avc1.640033',     ext: 'mp4' },
  { id: 'mp4',      mime: 'video/mp4;codecs=avc1.4d0033',     ext: 'mp4' },
  { id: 'mp4',      mime: 'video/mp4;codecs=avc1.42E01F',     ext: 'mp4' },
  { id: 'mp4',      mime: 'video/mp4',                         ext: 'mp4' },
  { id: 'webm-vp9', mime: 'video/webm;codecs=vp9,opus',        ext: 'webm' },
  { id: 'webm-vp9', mime: 'video/webm;codecs=vp9',             ext: 'webm' },
  { id: 'webm-vp8', mime: 'video/webm;codecs=vp8,opus',        ext: 'webm' },
  { id: 'webm-vp8', mime: 'video/webm;codecs=vp8',             ext: 'webm' },
  { id: 'webm',     mime: 'video/webm',                        ext: 'webm' },
];

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private currentMime = '';
  private currentExt = 'webm';
  private currentHint: string | null = null;
  private micStream: MediaStream | null = null;
  private outStream: MediaStream | null = null;
  private listeners = new Set<(state: 'idle' | 'recording' | 'finalizing') => void>();
  private savedListeners = new Set<(file: File) => void>();
  private startTime = 0;
  /** Active WebCodecs take, if that engine is recording. */
  private wc: import('./WebCodecsCapture').WebCodecsCapture | null = null;
  private wcActive = false;
  /** What the current / last take is encoded with, for the status line. */
  private engineText = '';
  /** Stereo-mode state captured at `start()` so `finalize()` knows
   *  whether to call the injector and which source to `stop()`. Null
   *  for monoscopic recordings. */
  private stereoState: {
    source: StereoRecordingSource;
    injectMetadata: boolean;
  } | null = null;
  /** Where to send the post-finalize outcome (toast plumbing). Null
   *  means "don't notify" — the recording still saves either way. */
  private outcomeListener: ((outcome: StereoFinalizeOutcome) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private sonification: SonificationCapture | null = null,
    /**
     * SV3D-equivalent metadata injector for stereo recordings.
     * Production code passes `injectStereoscopicMetadata` from
     * `./StereoMetadata`; tests pass a stub to exercise the
     * `failed` / `skipped` branches without needing a real MP4.
     * Defaults to null — without an injector, stereo recording
     * still produces the side-by-side file, just with no st3d box.
     */
    private injector: StereoMetadataInjector | null = null,
    /** Video element audio capture. Pass `VideoSourceManager` directly;
     *  the duck-typed interface means tests can stub it. */
    private videoAudioCapture: VideoAudioCapture | null = null,
    /** The running camera's video track, if any — pairs "Camera's microphone" with the
     *  audio input in the same device group (a webcam's built-in mic). */
    private cameraTrack: () => MediaStreamTrack | null = () => null,
  ) {}

  /** getUserMedia audio constraints for the chosen mic. */
  private async micConstraints(choice: string): Promise<MediaTrackConstraints | true> {
    if (choice && choice !== 'default') return { deviceId: { exact: choice } };
    if (choice === 'default') return true;
    // '' — the camera's own microphone: the audio input sharing the camera's groupId.
    try {
      const gid = this.cameraTrack()?.getSettings().groupId;
      if (gid) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mic = devices.find((d) => d.kind === 'audioinput' && d.groupId === gid && d.deviceId);
        if (mic) return { deviceId: { exact: mic.deviceId } };
      }
    } catch { /* fall through to the default input */ }
    return true; // a phone's (or a camera without a mic's) default input
  }

  /** Swap the metadata injector at runtime. Used by tests; also a
   *  reasonable knob for production if a future stage adds a
   *  user-pickable injector strategy. */
  setInjector(injector: StereoMetadataInjector | null): void {
    this.injector = injector;
  }

  /** Subscribe to the per-recording outcome — fired once on finalize.
   *  Used by `RecordSection` to surface a toast describing whether
   *  metadata was injected, skipped (non-MP4 container), or failed. */
  subscribeOutcome(fn: (outcome: StereoFinalizeOutcome) => void): () => void {
    this.outcomeListener = fn;
    return () => { if (this.outcomeListener === fn) this.outcomeListener = null; };
  }

  isRecording(): boolean {
    return this.wcActive || this.recorder?.state === 'recording';
  }

  /** e.g. "H.264 High · constant quality · 1920×1080 · 60 fps", or the compatibility note. */
  engineSummary(): string { return this.engineText; }

  /** Call right after every render (main.ts frame loop). Cheap no-op unless a WebCodecs take is running. */
  captureRenderedFrame(): void {
    if (this.wcActive) this.wc?.captureRenderedFrame();
  }

  /** Time elapsed (ms) since recording started; 0 when idle. */
  elapsedMs(): number {
    return this.isRecording() ? performance.now() - this.startTime : 0;
  }

  /** Fired after each recording is saved, with the file just downloaded —
   *  lets a phone UI offer the native share sheet (needs a fresh tap). */
  subscribeSaved(fn: (file: File) => void): () => void {
    this.savedListeners.add(fn);
    return () => this.savedListeners.delete(fn);
  }

  subscribe(fn: (state: 'idle' | 'recording' | 'finalizing') => void): () => void {
    this.listeners.add(fn);
    fn('idle');
    return () => this.listeners.delete(fn);
  }

  /** Returns supported formats actually usable on this device. */
  static availableFormats(): { id: string; mime: string }[] {
    const out: { id: string; mime: string }[] = [];
    const seen = new Set<string>();
    for (const f of FORMAT_CHAIN) {
      if (seen.has(f.id)) continue;
      try {
        if (MediaRecorder.isTypeSupported(f.mime)) {
          out.push({ id: f.id, mime: f.mime });
          seen.add(f.id);
        }
      } catch { /* ignore */ }
    }
    return out;
  }

  async start(opts: RecordOptions): Promise<void> {
    if (this.isRecording()) return;
    this.chunks = [];
    this.currentHint = opts.filenameHint ?? null;
    this.stereoState = null;

    const preferred = opts.preferredFormat ?? 'auto';
    const pick = pickFormat(preferred);
    if (!pick) throw new Error('No supported MediaRecorder format');
    this.currentMime = pick.mime;
    this.currentExt = pick.ext;

    let videoStream: MediaStream;
    if (opts.stereo?.enabled) {
      // Stereo path: start the compositor (it sizes its offscreen
      // canvas to 2× eye width), grab its captureStream, and stash
      // the source for cleanup at finalize. Filename gets a stereo
      // marker so the user can tell apart mono and stereo files
      // when they live in the same folder.
      opts.stereo.source.start(opts.stereo.eyeWidth, opts.stereo.eyeHeight);
      videoStream = opts.stereo.source.getStream(opts.fps);
      this.stereoState = {
        source: opts.stereo.source,
        injectMetadata: opts.stereo.injectMetadata,
      };
      this.currentHint = (opts.filenameHint ? `${opts.filenameHint}-` : '') + 'stereo-sbs';
    } else {
      videoStream = (this.canvas as HTMLCanvasElement & {
        captureStream(fps?: number): MediaStream;
      }).captureStream(opts.fps);
    }

    // Collect every audio track we want in the output: mic (when
    // requested AND available), the sonification voice (when the
    // synth's audio-output subsystem is currently producing a stream),
    // and the video element's own audio track (when requested AND the
    // source has one). The browser mixes all tracks inside MediaRecorder.
    const audioTracks: MediaStreamTrack[] = [];
    if (opts.includeMic) {
      try {
        const audio = await this.micConstraints(opts.micDeviceId ?? '');
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        } catch (err) {
          // A remembered device that's gone (unplugged webcam): use the default input.
          if (audio === true) throw err;
          console.warn('[record] chosen microphone unavailable, using the default input.', err);
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        for (const t of this.micStream.getAudioTracks()) audioTracks.push(t);
      } catch (err) {
        console.warn('Mic unavailable; recording video only.', err);
      }
    }
    if (opts.includeVideoAudio) {
      const vaStream = this.videoAudioCapture?.getCaptureStream();
      if (vaStream) {
        for (const t of vaStream.getAudioTracks()) audioTracks.push(t);
      } else {
        // No-op: source has no audio track, API is unsupported (Safari),
        // or videoAudioCapture was not provided. Continue without audio
        // rather than throwing — Principle 3: errors must be visible,
        // but a missing audio track is not a fatal recording error.
        console.warn('Video audio requested but not available for this source or browser.');
      }
    }
    const sonStream = this.sonification?.getCaptureStream();
    if (sonStream) {
      for (const t of sonStream.getAudioTracks()) audioTracks.push(t);
    }

    // ---- High-quality engine first ----
    if ((opts.engine ?? 'webcodecs') === 'webcodecs') {
      const srcCanvas = opts.stereo?.enabled ? opts.stereo.source.getCanvas?.() : this.canvas;
      try {
        const mod = await import('./WebCodecsCapture');
        if (!srcCanvas) throw new Error('stereo source has no canvas');
        if (!mod.webCodecsAvailable(audioTracks.length > 0)) throw new Error('WebCodecs is not available in this browser');
        this.wc = await mod.WebCodecsCapture.create({
          canvas: srcCanvas,
          fps: opts.fps,
          format: preferred as 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8',
          rateControl: opts.rateControl ?? 'quality',
          bitsPerSecond: opts.bitsPerSecond ?? 40_000_000,
          audioTracks,
        });
        // This engine reads the canvas itself; release the capture stream opened above.
        for (const t of videoStream.getVideoTracks()) t.stop();
        this.currentMime = this.wc.mime;
        this.currentExt = this.wc.ext;
        this.engineText = this.wc.summary;
        this.wcActive = true;
        this.startTime = performance.now();
        this.emit('recording');
        void Promise.all([import('../platform/WakeLock'), import('../platform/HapticFeedback')])
          .then(([{ wakeLock }, { haptic }]) => { void wakeLock().acquire(); haptic('success'); })
          .catch(() => { /* ignore */ });
        return;
      } catch (err) {
        this.wc = null;
        console.warn('[record] high-quality encoder unavailable, using MediaRecorder:', err);
        this.engineText = `compatibility encoder (${err instanceof Error ? err.message : String(err)})`;
      }
    } else {
      this.engineText = 'compatibility encoder (MediaRecorder)';
    }

    const combined = audioTracks.length === 0
      ? videoStream
      : new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
    this.outStream = combined;

    // MediaRecorder can throw on stream construction when the
    // requested frame is too large for the browser's encoder
    // (commonly: 4K stereo = 7680×2160 exceeds H.264 Main / VP9
    // tier limits on many GPUs). Catch and re-throw with a clear
    // message so the caller's status line can be specific instead
    // of the browser's opaque "NotSupportedError".
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(combined, {
        mimeType: this.currentMime,
        videoBitsPerSecond: opts.bitsPerSecond,
      });
    } catch (err) {
      // If we started the stereo compositor, tear it down — we
      // promised to pair `start` with `stop` per the source contract.
      if (this.stereoState) {
        this.stereoState.source.stop();
        this.stereoState = null;
      }
      const reason = err instanceof Error ? err.message : String(err);
      const hint = opts.stereo?.enabled
        ? ` (stereo output is ${opts.stereo.eyeWidth * 2}×${opts.stereo.eyeHeight}; try a lower Resolution preset for stereo recording)`
        : '';
      throw new Error(`MediaRecorder rejected this configuration: ${reason}${hint}`);
    }
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onstop = () => { void this.finalize(); };
    rec.start(1000); // emit chunks every second so a long recording survives a tab crash
    this.recorder = rec;
    this.startTime = performance.now();
    this.emit('recording');

    // Best-effort wake lock + haptic confirmation. Both are no-ops on
    // unsupported platforms. Imported lazily to keep the static graph small.
    void Promise.all([
      import('../platform/WakeLock'),
      import('../platform/HapticFeedback'),
    ]).then(([{ wakeLock }, { haptic }]) => {
      void wakeLock().acquire();
      haptic('success');
    }).catch(() => { /* ignore */ });
  }

  stop(): void {
    if (this.wcActive && this.wc) {
      const wc = this.wc;
      this.wcActive = false;
      this.emit('finalizing');
      void wc.finish()
        .then((blob) => this.finalize(blob))
        .catch((err) => {
          console.error('[record] could not finalize recording', err);
          this.engineText = `save failed: ${err instanceof Error ? err.message : String(err)}`;
          this.wc = null;
          this.stereoState?.source.stop();
          this.stereoState = null;
          for (const t of this.micStream?.getTracks() ?? []) t.stop();
          this.micStream = null;
          this.emit('idle');
        });
      return;
    }
    if (!this.recorder || this.recorder.state === 'inactive') return;
    this.emit('finalizing');
    this.recorder.stop();
  }

  private async finalize(encoded?: Blob): Promise<void> {
    let blob = encoded ?? new Blob(this.chunks, { type: this.currentMime });
    this.wc = null;
    let outcome: StereoFinalizeOutcome = null;

    // Stereo path: stop the compositor and (when an MP4 was produced
    // AND the user wants metadata) route the blob through the
    // injector. The blob is always saved either way — injection
    // failure is surfaced, never silently swallowed.
    if (this.stereoState) {
      this.stereoState.source.stop();
      if (this.stereoState.injectMetadata && this.injector) {
        try {
          outcome = await this.injector(blob);
          blob = outcome.blob;
        } catch (err) {
          // Defensive: a throwing injector shouldn't lose the file.
          outcome = {
            kind: 'failed',
            blob,
            reason: err instanceof Error ? err.message : 'injector threw',
          };
        }
      }
      this.stereoState = null;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const hint = this.currentHint ? `${slugify(this.currentHint)}-` : '';
    a.href = url;
    a.download = `${hint}ruttetra-${ts}.${this.currentExt}`;
    a.click();
    if (this.savedListeners.size) {
      const file = new File([blob], a.download, { type: this.currentMime || blob.type });
      for (const fn of this.savedListeners) fn(file);
    }
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = null;
    this.outStream = null;
    this.recorder = null;
    this.emit('idle');

    // Fire the stereo outcome AFTER 'idle' so the toast doesn't
    // arrive while the section UI still reads as recording.
    if (this.outcomeListener) this.outcomeListener(outcome);

    // Release wake lock + tap haptic.
    void Promise.all([
      import('../platform/WakeLock'),
      import('../platform/HapticFeedback'),
    ]).then(([{ wakeLock }, { haptic }]) => {
      void wakeLock().release();
      haptic('tap');
    }).catch(() => { /* ignore */ });
  }

  private emit(s: 'idle' | 'recording' | 'finalizing'): void {
    for (const fn of this.listeners) fn(s);
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function pickFormat(pref: string): { mime: string; ext: string } | null {
  if (pref !== 'auto') {
    for (const f of FORMAT_CHAIN) {
      if (f.id === pref && MediaRecorder.isTypeSupported(f.mime)) return f;
    }
  }
  for (const f of FORMAT_CHAIN) {
    try {
      if (MediaRecorder.isTypeSupported(f.mime)) return f;
    } catch { /* ignore */ }
  }
  return null;
}
