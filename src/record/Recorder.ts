/**
 * Wraps `MediaRecorder` to capture the WebGL canvas (with optional mic
 * audio and / or sonification voice) and trigger a download when the
 * user stops.
 *
 * Codec preference: MP4/H.264 → WebM/VP9 → WebM/VP8. Some browsers (Chrome
 * on Linux, older Firefox) only support WebM.
 *
 * Audio sources mixed into the stream:
 *   - mic (optional, via getUserMedia)
 *   - sonification voice (optional, when the synth's audible-output
 *     subsystem is enabled — captured post-master, post-limiter)
 *
 * Both can be active simultaneously. The browser handles cross-track
 * mixing inside the MediaRecorder.
 */

/** Sonification capture interface — only what the recorder needs from
 *  `Sonification`. Kept duck-typed so tests can stub it. */
export interface SonificationCapture {
  getCaptureStream(): MediaStream | null;
}

export interface RecordOptions {
  fps: number;
  bitsPerSecond?: number;
  includeMic?: boolean;
  preferredFormat?: 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
  /** Optional slug prepended to the auto-generated filename (no extension). */
  filenameHint?: string;
}

const FORMAT_CHAIN: { id: string; mime: string; ext: string }[] = [
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
  private startTime = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sonification: SonificationCapture | null = null,
  ) {}

  isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Time elapsed (ms) since recording started; 0 when idle. */
  elapsedMs(): number {
    return this.isRecording() ? performance.now() - this.startTime : 0;
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

    const preferred = opts.preferredFormat ?? 'auto';
    const pick = pickFormat(preferred);
    if (!pick) throw new Error('No supported MediaRecorder format');
    this.currentMime = pick.mime;
    this.currentExt = pick.ext;

    const videoStream = (this.canvas as any).captureStream(opts.fps) as MediaStream;

    // Collect every audio track we want in the output: mic (when
    // requested AND available) plus the sonification voice (when the
    // synth's audio-output subsystem is currently producing a stream).
    // The browser mixes them inside MediaRecorder.
    const audioTracks: MediaStreamTrack[] = [];
    if (opts.includeMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        for (const t of this.micStream.getAudioTracks()) audioTracks.push(t);
      } catch (err) {
        console.warn('Mic unavailable; recording video only.', err);
      }
    }
    const sonStream = this.sonification?.getCaptureStream();
    if (sonStream) {
      for (const t of sonStream.getAudioTracks()) audioTracks.push(t);
    }

    const combined = audioTracks.length === 0
      ? videoStream
      : new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
    this.outStream = combined;

    const rec = new MediaRecorder(combined, {
      mimeType: this.currentMime,
      videoBitsPerSecond: opts.bitsPerSecond,
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onstop = () => this.finalize();
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
    if (!this.recorder || this.recorder.state === 'inactive') return;
    this.emit('finalizing');
    this.recorder.stop();
  }

  private finalize(): void {
    const blob = new Blob(this.chunks, { type: this.currentMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const hint = this.currentHint ? `${slugify(this.currentHint)}-` : '';
    a.href = url;
    a.download = `${hint}ruttetra-${ts}.${this.currentExt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = null;
    this.outStream = null;
    this.recorder = null;
    this.emit('idle');

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
