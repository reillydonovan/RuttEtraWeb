/**
 * Viewer mode — when the page loads with `?view=<peerId>` we hide all UI
 * and connect to that broadcaster, attaching the incoming MediaStream to
 * a fullscreen <video> element.
 *
 * Because PeerJS calls are initiated by the *caller*, the viewer needs
 * to dial the broadcaster. We open a DataConnection first to let the
 * broadcaster know to answer, but in practice the simpler pattern is
 * for the viewer to call the broadcaster with a tiny dummy stream so
 * the broadcaster's `'call'` event fires and replies with its real
 * media. We use a 1×1 black canvas as the dummy.
 */

import Peer, { MediaConnection } from 'peerjs';

export class Viewer {
  private peer: Peer | null = null;
  private call: MediaConnection | null = null;
  private dummyStream: MediaStream | null = null;
  private retryTimer: number | null = null;

  constructor(private targetId: string, private videoEl: HTMLVideoElement) {}

  async start(): Promise<void> {
    document.body.classList.add('viewer-mode');
    this.dummyStream = makeDummyStream();
    this.connect();
  }

  stop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.call?.close();
    this.peer?.destroy();
    if (this.dummyStream) {
      for (const t of this.dummyStream.getTracks()) t.stop();
    }
    this.peer = null;
    this.call = null;
    this.dummyStream = null;
  }

  private connect(): void {
    this.peer?.destroy();
    this.peer = new Peer();
    this.peer.on('open', () => {
      if (!this.peer || !this.dummyStream) return;
      const call = this.peer.call(this.targetId, this.dummyStream);
      this.call = call;
      call.on('stream', (remote) => {
        this.videoEl.srcObject = remote;
        this.videoEl.play().catch(() => {});
      });
      call.on('close', () => this.scheduleRetry());
      call.on('error', () => this.scheduleRetry());
    });
    this.peer.on('error', (err) => {
      console.warn('viewer peer error', err);
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), 2500);
  }
}

function makeDummyStream(): MediaStream {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 16, 16);
  // Animate so the stream actually has data
  setInterval(() => {
    ctx.fillStyle = `rgb(0,0,${Math.random() * 4 | 0})`;
    ctx.fillRect(0, 0, 16, 16);
  }, 1000);
  return (c as any).captureStream(2) as MediaStream;
}
