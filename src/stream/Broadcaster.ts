/**
 * Peer-to-peer broadcaster using PeerJS.
 *
 * Generates a peer ID, exposes a share URL, and on each incoming call,
 * answers with the canvas's MediaStream (plus optional mic, plus
 * optional sonification voice when the synth's audible-output
 * subsystem is enabled).
 *
 * Each connected viewer is tracked so the UI can show a viewer count.
 * No backend required — uses PeerJS's free public broker by default.
 */

import Peer, { MediaConnection } from 'peerjs';

export type BroadcastState = 'idle' | 'connecting' | 'live' | 'error';

/** Capture surface from `Sonification` — duck-typed so tests can
 *  stub it and the broadcaster doesn't import the audio module. */
export interface SonificationCapture {
  getCaptureStream(): MediaStream | null;
}

interface BroadcasterOptions {
  canvas: HTMLCanvasElement;
  fps?: number;
  includeMic?: boolean;
}

type Listener = (state: BroadcastState, info: { id: string; viewers: number; error?: string }) => void;

export class Broadcaster {
  private peer: Peer | null = null;
  private id = '';
  private viewers = new Set<MediaConnection>();
  private state: BroadcastState = 'idle';
  private listeners = new Set<Listener>();
  private streamCache: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private opts: BroadcasterOptions = { canvas: null as any };

  constructor(private sonification: SonificationCapture | null = null) {}

  /** Public read-only view of the current broadcast state. */
  getState(): BroadcastState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state, { id: this.id, viewers: this.viewers.size });
    return () => this.listeners.delete(fn);
  }

  async start(opts: BroadcasterOptions): Promise<void> {
    if (this.peer) await this.stop();
    this.opts = opts;
    this.setState('connecting');

    if (opts.includeMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        console.warn('Mic unavailable for broadcast:', err);
      }
    }

    this.streamCache = this.buildStream();

    this.peer = new Peer();
    this.peer.on('open', (id) => {
      this.id = id;
      this.setState('live');
      void Promise.all([
        import('../platform/WakeLock'),
        import('../platform/HapticFeedback'),
      ]).then(([{ wakeLock }, { haptic }]) => {
        void wakeLock().acquire();
        haptic('success');
      }).catch(() => { /* ignore */ });
    });
    this.peer.on('error', (err) => {
      console.error('PeerJS error', err);
      this.setState('error', err.message);
    });
    this.peer.on('call', (call) => {
      if (!this.streamCache) return;
      call.answer(this.streamCache);
      this.viewers.add(call);
      this.emit();
      call.on('close', () => { this.viewers.delete(call); this.emit(); });
      call.on('error', () => { this.viewers.delete(call); this.emit(); });
    });
  }

  async stop(): Promise<void> {
    for (const c of this.viewers) c.close();
    this.viewers.clear();
    this.peer?.destroy();
    this.peer = null;
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    this.streamCache = null;
    this.id = '';
    this.setState('idle');
    void import('../platform/WakeLock').then(({ wakeLock }) => {
      void wakeLock().release();
    }).catch(() => { /* ignore */ });
  }

  shareURL(): string {
    if (!this.id) return '';
    const u = new URL(window.location.href);
    u.searchParams.set('view', this.id);
    return u.toString();
  }

  private buildStream(): MediaStream {
    const c = this.opts.canvas as any;
    const v = c.captureStream(this.opts.fps ?? 30) as MediaStream;
    const audioTracks: MediaStreamTrack[] = [];
    if (this.micStream) {
      for (const t of this.micStream.getAudioTracks()) audioTracks.push(t);
    }
    const sonStream = this.sonification?.getCaptureStream();
    if (sonStream) {
      for (const t of sonStream.getAudioTracks()) audioTracks.push(t);
    }
    if (audioTracks.length === 0) return v;
    return new MediaStream([...v.getVideoTracks(), ...audioTracks]);
  }

  private setState(s: BroadcastState, error?: string): void {
    this.state = s;
    this.emit(error);
  }
  private emit(error?: string): void {
    for (const fn of this.listeners) fn(this.state, { id: this.id, viewers: this.viewers.size, error });
  }
}
