/**
 * Manages the active video source for the synthesizer.
 *
 * Exposes a single shared `HTMLVideoElement` so the rest of the app (and the
 * Three.js VideoTexture) only ever needs one stable handle. Switching sources
 * tears down the previous stream cleanly.
 */

export type SourceKind = 'webcam' | 'file' | 'screen' | 'stream' | 'none';

export interface SourceState {
  kind: SourceKind;
  label: string;
  width: number;
  height: number;
  stream: MediaStream | null;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

type Listener = (state: SourceState) => void;

export class VideoSourceManager {
  private listeners = new Set<Listener>();
  private state: SourceState = {
    kind: 'none', label: '', width: 0, height: 0, stream: null,
  };
  private fileObjectUrl: string | null = null;
  /** hls.js instance, alive for the duration of an active HLS stream. */
  private hlsInstance: import('hls.js').default | null = null;

  constructor(public readonly video: HTMLVideoElement) {
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.addEventListener('loadedmetadata', () => this.onMeta());
    video.addEventListener('resize', () => this.onMeta());
  }

  getState(): Readonly<SourceState> {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Enumerate available video input devices. Requires prior permission for labels. */
  async listDevices(): Promise<DeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async useWebcam(opts: {
    deviceId?: string;
    width?: number;
    height?: number;
    fps?: number;
    facingMode?: 'user' | 'environment';
  } = {}): Promise<void> {
    this.stop();
    // On touch devices, request the camera by `facingMode` rather than a
    // pinned deviceId — many phones swap the active camera at runtime.
    const videoConstraints: MediaTrackConstraints = {
      width:  opts.width  ? { ideal: opts.width  } : undefined,
      height: opts.height ? { ideal: opts.height } : undefined,
      frameRate: opts.fps ? { ideal: opts.fps } : undefined,
    };
    if (opts.deviceId) {
      videoConstraints.deviceId = { exact: opts.deviceId };
    } else if (opts.facingMode) {
      videoConstraints.facingMode = { ideal: opts.facingMode };
    }
    const constraints: MediaStreamConstraints = {
      video: videoConstraints,
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = stream;
    await this.video.play().catch(() => {/* autoplay restrictions */});
    const track = stream.getVideoTracks()[0];
    const label = track?.label || 'Webcam';
    // On iOS Safari, video.videoWidth/Height can lag behind the real frame
    // size on portrait orientation. `getSettings()` gives us the truth.
    const settings = track?.getSettings ? track.getSettings() : null;
    const width  = settings?.width  ?? this.state.width;
    const height = settings?.height ?? this.state.height;
    this.update({ kind: 'webcam', label, stream, width, height });
  }

  async useScreen(opts: { fps?: number } = {}): Promise<void> {
    this.stop();
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: opts.fps ? { frameRate: { ideal: opts.fps } } : true,
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    this.update({ kind: 'screen', label: 'Screen', stream });

    // If user clicks the browser stop-sharing button, fall back gracefully.
    const t = stream.getVideoTracks()[0];
    if (t) t.addEventListener('ended', () => this.stop());
  }

  useFile(file: File): void {
    this.stop();
    const url = URL.createObjectURL(file);
    this.fileObjectUrl = url;
    this.video.srcObject = null;
    this.video.src = url;
    this.video.loop = true;
    this.video.play().catch(() => {});
    this.update({ kind: 'file', label: file.name, stream: null });
  }

  /**
   * Connect to a remote video stream.
   *
   * URL routing:
   *   - `.m3u8` / `application/vnd.apple.mpegurl` → HLS
   *     Safari: native (no extra library).
   *     Chrome / Firefox / Edge: hls.js, dynamically imported on first use.
   *   - `.mpd` → MPEG-DASH. Not supported natively; throws with a clear
   *     message recommending re-muxing to HLS or using a direct video URL.
   *   - Anything else → set as a direct `<video src>` and let the browser
   *     decide. Works for MP4/WebM relay URLs, RTSP over WebRTC proxy, etc.
   *
   * Rejects with a human-readable Error on URL parse failure, missing
   * browser support, or HLS fatal error (Principle 3 — no silent fallbacks).
   */
  async useStreamUrl(rawUrl: string): Promise<void> {
    this.stop();

    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new Error(`Invalid URL: "${rawUrl.trim()}"`);
    }

    const pathname = url.pathname.toLowerCase();
    const isHls = pathname.endsWith('.m3u8')
      || url.searchParams.has('format') && url.searchParams.get('format') === 'hls';
    const isDash = pathname.endsWith('.mpd');

    if (isDash) {
      throw new Error(
        'MPEG-DASH streams (.mpd) are not supported. ' +
        'Re-mux to HLS (.m3u8) using ffmpeg or use a direct MP4/WebM URL.'
      );
    }

    const shortLabel = url.hostname + (pathname !== '/' ? pathname.split('/').pop() ?? '' : '');

    if (isHls) {
      // --- Safari: native HLS support ---
      if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this.video.src = rawUrl.trim();
        this.video.load();
        await this.video.play().catch(() => {});
        this.update({ kind: 'stream', label: shortLabel, stream: null });
        return;
      }

      // --- Other browsers: hls.js ---
      const { default: Hls } = await import('hls.js').catch(() => {
        throw new Error('Failed to load HLS library. Check your network and try again.');
      });

      if (!Hls.isSupported()) {
        throw new Error(
          'HLS playback is not supported in this browser. ' +
          'Try Chrome, Firefox, or Edge, or use a direct MP4/WebM URL.'
        );
      }

      const hls = new Hls({ enableWorker: false });
      this.hlsInstance = hls;

      await new Promise<void>((resolve, reject) => {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          this.video.play().catch(() => {});
          resolve();
        });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) {
            hls.destroy();
            this.hlsInstance = null;
            reject(new Error(`HLS stream error: ${data.details}`));
          }
        });
        hls.loadSource(rawUrl.trim());
        hls.attachMedia(this.video);
      });

      this.update({ kind: 'stream', label: shortLabel, stream: null });
      return;
    }

    // --- Direct video URL (MP4, WebM, or any browser-playable source) ---
    this.video.srcObject = null;
    this.video.src = rawUrl.trim();
    this.video.load();
    await this.video.play().catch(() => {});
    this.update({ kind: 'stream', label: shortLabel, stream: null });
  }

  /** Stop the active source and release resources. */
  stop(): void {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
    if (this.state.stream) {
      for (const t of this.state.stream.getTracks()) t.stop();
    }
    if (this.fileObjectUrl) {
      URL.revokeObjectURL(this.fileObjectUrl);
      this.fileObjectUrl = null;
    }
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
    this.update({ kind: 'none', label: '', width: 0, height: 0, stream: null });
  }

  /** Try to refresh device labels after we have permission (browsers hide labels otherwise). */
  static async ensurePermission(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      for (const t of s.getTracks()) t.stop();
      return true;
    } catch {
      return false;
    }
  }

  private onMeta(): void {
    this.update({
      ...this.state,
      width: this.video.videoWidth || this.state.width,
      height: this.video.videoHeight || this.state.height,
    });
  }

  private update(next: Partial<SourceState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn(this.state);
  }
}
