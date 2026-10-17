/**
 * High-quality recording engine: WebCodecs encoder + mediabunny muxer.
 *
 * The canvas is read right after each render (`captureRenderedFrame`, called
 * from main.ts's frame loop) on a fixed frame grid (encodePlan.frameSlot), so
 * the file runs at a true constant rate whichever window is driving the
 * render. Encoder settings are quality-first: H.264 High (or VP9/AV1),
 * latencyMode 'quality' (no dropped frames), a 2 s keyframe interval, the
 * 'detail' content hint, and constant-quality rate control by default. The
 * frame size is locked at the first frame; a canvas resize mid-take is
 * letterboxed instead of silently rescaling the stream.
 *
 * Audio: every requested track is mixed in one AudioContext into a single
 * stereo track and encoded as AAC (MP4) / Opus (WebM).
 *
 * Loaded lazily (dynamic import) — mediabunny never ships in the boot bundle.
 */

import {
  Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource,
  MediaStreamAudioTrackSource, Quality, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
  type VideoCodec, type AudioCodec,
} from 'mediabunny';
import { formatPlan, evenSize, frameSlot, describeEncode, type RecordFormatPref, type PlanVideoCodec } from './encodePlan';

/** Encoder pipeline depth; beyond this a rendered frame is held (longer duration) instead. */
const MAX_IN_FLIGHT = 4;

export interface WebCodecsCaptureOptions {
  canvas: HTMLCanvasElement;
  fps: number;
  format: RecordFormatPref;
  rateControl: 'quality' | 'bitrate';
  bitsPerSecond: number;
  audioTracks: MediaStreamTrack[];
}

/** True when this browser has the APIs the engine needs (Chrome/Edge 94+, Safari 16.4+ for video). */
export function webCodecsAvailable(needsAudio: boolean): boolean {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
  // Live audio capture needs AudioEncoder; mediabunny reads the track itself.
  if (needsAudio && typeof AudioEncoder === 'undefined') return false;
  return true;
}

export class WebCodecsCapture {
  readonly mime: string;
  readonly ext: string;
  /** e.g. "H.264 High · constant quality · 1920×1080 · 60 fps" — shown on the status line. */
  readonly summary: string;

  private nextIndex = 0;
  /** Frames handed to the encoder and not yet accepted — a small pipeline, so encode
   *  latency doesn't cap throughput (one-at-a-time measured ~33 of 60 fps). */
  private inFlight = 0;
  private stopped = false;
  private startMs = 0;
  private error: unknown = null;

  private constructor(
    private output: Output,
    private target: BufferTarget,
    private video: CanvasSource,
    private fps: number,
    private audioCtx: AudioContext | null,
    mime: string, ext: string, summary: string,
  ) {
    this.mime = mime; this.ext = ext; this.summary = summary;
  }

  /** Build and start an encoder for this canvas, or throw with a readable reason. */
  static async create(o: WebCodecsCaptureOptions): Promise<WebCodecsCapture> {
    const plan = formatPlan(o.format);
    const { w, h } = evenSize(o.canvas.width, o.canvas.height);
    const quality = o.rateControl === 'quality'
      ? new Quality('very-high') // quantizer (CRF-like) where the encoder supports it, else a high bitrate
      : new Quality({ bitrate: o.bitsPerSecond, bitrateMode: 'variable' });

    const codec = await getFirstEncodableVideoCodec(plan.videoCodecs as VideoCodec[], {
      width: w, height: h, quality, frameRate: o.fps,
    });
    if (!codec) throw new Error(`no encoder for ${w}×${h} in ${plan.container.toUpperCase()} on this browser`);

    const format = plan.container === 'mp4'
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });

    const odd = w !== o.canvas.width || h !== o.canvas.height;
    const video = new CanvasSource(o.canvas, {
      codec,
      quality,
      latencyMode: 'quality',
      keyFrameInterval: 2,
      contentHint: 'detail',
      sizeChangeBehavior: 'contain',
      ...(odd ? { transform: { crop: { left: 0, top: 0, width: w, height: h } } } : {}),
    });
    output.addVideoTrack(video, { frameRate: o.fps });

    // One mixed audio track (mic + video audio + sonification).
    let audioCtx: AudioContext | null = null;
    if (o.audioTracks.length) {
      const acodec = await getFirstEncodableAudioCodec(plan.audioCodecs as AudioCodec[], {
        numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 192_000 }),
      });
      if (acodec) {
        let track: MediaStreamAudioTrack;
        if (o.audioTracks.length === 1) {
          // One source (the usual case: the mic) goes straight to the encoder — no AudioContext,
          // which iOS starts suspended and which would otherwise record silence.
          track = o.audioTracks[0] as MediaStreamAudioTrack;
        } else {
          audioCtx = new AudioContext({ sampleRate: 48000 });
          await audioCtx.resume().catch(() => { /* already running */ });
          const dest = audioCtx.createMediaStreamDestination();
          dest.channelCount = 2;
          for (const t of o.audioTracks) audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
          track = dest.stream.getAudioTracks()[0] as MediaStreamAudioTrack;
        }
        output.addAudioTrack(new MediaStreamAudioTrackSource(track, { codec: acodec, quality: new Quality({ bitrate: 192_000 }) }));
      } else {
        console.warn('[record] no audio encoder for this container; recording video only.');
      }
    }

    await output.start();
    const mime = format.mimeType;
    const summary = describeEncode(codec as PlanVideoCodec, o.rateControl, Math.round(o.bitsPerSecond / 1e6), w, h, o.fps);
    const cap = new WebCodecsCapture(output, target, video, o.fps, audioCtx, mime, format.fileExtension.replace(/^\./, ''), summary);
    cap.startMs = performance.now();
    return cap;
  }

  /** Called right after every render. Captures when a frame slot is due and the encoder is free. */
  captureRenderedFrame(): void {
    if (this.stopped || this.inFlight >= MAX_IN_FLIGHT || this.error) return;
    const slot = frameSlot((performance.now() - this.startMs) / 1000, this.fps, this.nextIndex);
    if (!slot) return;
    this.nextIndex = slot.next;
    this.inFlight++;
    this.video.add(slot.timestamp, slot.duration)
      .catch((err) => { this.error = err; console.error('[record] encode failed', err); })
      .finally(() => { this.inFlight--; });
  }

  /** Last encoder error, if any (the take is still finalized with what was encoded). */
  get failure(): unknown { return this.error; }

  async finish(): Promise<Blob> {
    this.stopped = true;
    // Let an in-flight frame land before closing the track.
    while (this.inFlight > 0) await new Promise((r) => setTimeout(r, 5));
    try {
      await this.output.finalize();
    } finally {
      void this.audioCtx?.close();
    }
    const buf = this.target.buffer;
    if (!buf) throw new Error('recording produced no data');
    return new Blob([buf], { type: this.mime });
  }

  async cancel(): Promise<void> {
    this.stopped = true;
    await this.output.cancel().catch(() => { /* already gone */ });
    void this.audioCtx?.close();
  }
}
