/**
 * WHIP (WebRTC HTTP Ingestion Protocol) canvas output publisher.
 *
 * Sends the synth's canvas as a live WebRTC stream to any WHIP-compatible
 * endpoint. The server re-distributes the stream as HLS, RTMP, or further
 * WebRTC — the synth only speaks WHIP.
 *
 * Compatible servers (tested or spec-compliant):
 *   - OBS 30+           (WHIP input: Tools → WHIP Server)
 *   - MediaMTX          (free, self-hosted; WHIP path `/whip/<stream-name>`)
 *   - Cloudflare Stream (requires bearer token)
 *   - LiveKit Cloud     (requires bearer token)
 *   - Janus WebRTC      (via janus-gateway WHIP plugin)
 *
 * Protocol summary (draft-ietf-wish-whip):
 *   1. POST SDP offer to endpoint (with optional bearer token).
 *   2. Server replies 201 Created: body = SDP answer, Location = resource URL.
 *   3. To tear down, DELETE the resource URL.
 *   ICE trickle (PATCH) is optional and not implemented in v1; we wait for
 *   full ICE gathering before sending the offer (gather-and-send pattern).
 *
 * The publisher does NOT touch Settings. Connection state (idle / connecting /
 * live / error) is owned here; the WHIP endpoint URL is passed in at start().
 */

import { setOutputActive } from '../renderer/rasterIdentify';

export type WhipState = 'idle' | 'connecting' | 'live' | 'error';

export interface WhipInfo {
  error?: string;
}

type Listener = (state: WhipState, info: WhipInfo) => void;

interface StartOptions {
  canvas: HTMLCanvasElement;
  fps: number;
  endpoint: string;
  bearerToken?: string;
}

/** Capture surface from `Sonification` — duck-typed for testability. */
export interface SonificationCapture {
  getCaptureStream(): MediaStream | null;
}

export class WhipPublisher {
  private pc: RTCPeerConnection | null = null;
  private resourceUrl: string | null = null;
  private state: WhipState = 'idle';
  private listeners = new Set<Listener>();

  constructor(private sonification: SonificationCapture | null = null) {}

  getState(): WhipState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state, {});
    return () => this.listeners.delete(fn);
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.pc) await this.stop();
    this.setState('connecting');

    try {
      const stream = opts.canvas.captureStream(opts.fps);

      // Add sonification audio tracks if available
      const audioStream = this.sonification?.getCaptureStream();
      if (audioStream) {
        for (const track of audioStream.getAudioTracks()) {
          stream.addTrack(track);
        }
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.pc = pc;

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete before sending the offer so all
      // candidates are included in a single HTTP round-trip. This avoids the
      // need for trickle-ICE PATCH support on the server.
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const onStateChange = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', onStateChange);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', onStateChange);
        // Timeout fallback: 8 s is generous for LAN; NAT traversal may need it.
        setTimeout(resolve, 8000);
      });

      // Abort if the user stopped the session while ICE was gathering.
      if (!this.pc) return;

      const headers: Record<string, string> = {
        'Content-Type': 'application/sdp',
      };
      if (opts.bearerToken) {
        headers['Authorization'] = `Bearer ${opts.bearerToken}`;
      }

      const resp = await fetch(opts.endpoint, {
        method: 'POST',
        headers,
        body: pc.localDescription!.sdp,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`WHIP server returned ${resp.status}: ${text || resp.statusText}`);
      }

      const answerSdp = await resp.text();
      this.resourceUrl = resp.headers.get('Location') ?? null;

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') {
          this.setState('error', 'ICE connection failed. Check the WHIP server address and network path.');
        } else if (pc.connectionState === 'disconnected') {
          this.setState('error', 'Connection lost. The WHIP server disconnected.');
        }
      });

      this.setState('live');
    } catch (err) {
      this.pc?.close();
      this.pc = null;
      this.setState('error', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (this.resourceUrl) {
      // WHIP teardown: DELETE the resource URL given in the 201 Location header.
      fetch(this.resourceUrl, { method: 'DELETE' }).catch(() => {});
      this.resourceUrl = null;
    }
    this.pc?.close();
    this.pc = null;
    this.setState('idle');
  }

  private setState(state: WhipState, error?: string): void {
    this.state = state;
    // Setup-only raster identify tint must never reach the stream.
    setOutputActive('whip', state === 'connecting' || state === 'live');
    const info: WhipInfo = error ? { error } : {};
    for (const fn of this.listeners) fn(state, info);
  }
}
