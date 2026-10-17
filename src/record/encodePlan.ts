/**
 * Pure planning for the WebCodecs recording engine (WebCodecsCapture.ts).
 *
 * Why this engine exists (record-quality audit, 2026-10-17): MediaRecorder
 * gave us H.264 *Constrained Baseline* (no CABAC, no B-frames, no 8×8
 * transform), a realtime rate controller that drops frames (~49 of 60 fps
 * measured), and it silently rescaled when the canvas resized mid-take.
 * Thin bright scan lines on black are the worst case for all three. Driving
 * the encoder directly lets us pick H.264 High (or VP9/AV1), quality-first
 * latency, constant-quality rate control, a locked frame size, and a frame
 * clock derived from real time.
 *
 * No DOM, no WebCodecs — unit-tested in __tests__/encodePlan.test.ts.
 */

export type RecordFormatPref = 'auto' | 'mp4' | 'webm-vp9' | 'webm-vp8';
export type PlanVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
export type PlanAudioCodec = 'aac' | 'opus' | 'vorbis';

export interface FormatPlan {
  container: 'mp4' | 'webm';
  /** Codecs to try in order; the first one the browser can encode at this size wins. */
  videoCodecs: PlanVideoCodec[];
  audioCodecs: PlanAudioCodec[];
}

/** Container + codec preference for the user's Format choice. MP4 leads with H.264 because
 *  every editor opens it; VP9/AV1 follow as fallbacks the container also allows. */
export function formatPlan(pref: RecordFormatPref): FormatPlan {
  switch (pref) {
    case 'webm-vp9': return { container: 'webm', videoCodecs: ['vp9', 'av1', 'vp8'], audioCodecs: ['opus', 'vorbis'] };
    case 'webm-vp8': return { container: 'webm', videoCodecs: ['vp8', 'vp9'], audioCodecs: ['opus', 'vorbis'] };
    case 'mp4':
    case 'auto':
    default:         return { container: 'mp4', videoCodecs: ['avc', 'vp9', 'av1'], audioCodecs: ['aac', 'opus'] };
  }
}

/** 4:2:0 video needs even dimensions; odd canvas sizes (Match Window) are cropped by one pixel. */
export function evenSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(2, Math.floor(w / 2) * 2), h: Math.max(2, Math.floor(h / 2) * 2) };
}

export interface FrameSlot {
  /** Presentation time of this frame, seconds from the start of the take. */
  timestamp: number;
  /** How long it is shown — one frame, or longer when rendering fell behind. */
  duration: number;
  /** Frame index to wait for next. */
  next: number;
}

/**
 * Decide whether a freshly rendered frame should be captured, on a fixed frame grid at `fps`.
 * Frames rendered faster than `fps` are skipped; when rendering falls behind, the captured
 * frame is held for the missed slots (longer duration), so the file's timing always matches
 * real time and nothing speeds up or drifts out of sync with the audio.
 */
export function frameSlot(elapsedSec: number, fps: number, nextIndex: number): FrameSlot | null {
  const slot = Math.floor(elapsedSec * fps + 1e-6);
  if (slot < nextIndex) return null;
  const start = Math.min(nextIndex, slot);
  return { timestamp: start / fps, duration: (slot + 1 - start) / fps, next: slot + 1 };
}

/** Human summary for the status line, e.g. "H.264 High · constant quality · 1920×1080 · 60 fps". */
export function describeEncode(codec: PlanVideoCodec, rate: 'quality' | 'bitrate', mbps: number, w: number, h: number, fps: number): string {
  const name: Record<PlanVideoCodec, string> = { avc: 'H.264 High', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };
  const rc = rate === 'quality' ? 'constant quality' : `${mbps} Mbps`;
  return `${name[codec]} · ${rc} · ${w}×${h} · ${fps} fps`;
}
