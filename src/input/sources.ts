/**
 * Manages the active video source for the synthesizer.
 *
 * Exposes a single shared `HTMLVideoElement` so the rest of the app (and the
 * Three.js VideoTexture) only ever needs one stable handle. Switching sources
 * tears down the previous stream cleanly.
 */

export type SourceKind = 'webcam' | 'file' | 'screen' | 'none';

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

  /** Stop the active source and release resources. */
  stop(): void {
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
