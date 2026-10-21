/**
 * Offline render mode: `?render=offline&job=<url>`. Deterministic and frame-stepped.
 *
 * The live app is unchanged: nothing here runs unless the URL asks for it. In this mode
 * main.ts never starts `setAnimationLoop`; instead a driver (tools/offline-render/render.mjs,
 * Playwright) calls `window.__ruttOffline.renderFrame(i)` once per output frame:
 *
 *   t = i / fps, dt = 1 / fps   -- every engine sees the same time and step every run
 *   source frame i              -- a PNG loaded by index, never `video.currentTime`
 *   spectrum frame i            -- precomputed (fft_frames.bin), fed where the AnalyserNode was
 *   seeded chance               -- src/platform/determinism.ts
 *
 * and gets back the frame as a PNG plus a SHA-256 of its pixels (the determinism test
 * renders a job twice and compares those hashes).
 *
 * fft_frames.bin (little-endian): "RWFF", u32 version=1, u32 fftSize, u32 sampleRate,
 * u32 fps, u32 frameCount; then frameCount x (fftSize/2) f32 bin magnitudes in dBFS
 * (Blackman window, |X|/fftSize, as Chrome's AnalyserNode computes before byte mapping);
 * then frameCount x fftSize f32 time-domain samples (the window ending at t).
 */
import * as THREE from 'three';
import type { FFTAnalyzer, OfflineSpectrumSource } from '../audio/FFTAnalyzer';
import { DEFAULTS, presetPatch, type PerformanceProfileId, type Settings, type SettingsStore } from '../state/Settings';
import type { RuttEtraScene } from '../renderer/RuttEtra';
import { useOfflineDeterminism } from '../platform/determinism';

/** The camera transform (CameraRig's CAM_KEYS); reset with every still so no pose carries over. */
const CAMERA_TRANSFORM_KEYS = ['camPosX', 'camPosY', 'camPosZ', 'camRotX', 'camRotY', 'camRotZ'] as const;

export interface OfflineJob {
  /** Source frame URL with `{i}` = 1-based zero-padded index, e.g. `/reel/frames/{i}.png`.
   *  Either this or `video`. */
  frames?: string;
  /** A video file decoded IN ORDER, frame-exactly, with WebCodecs (mediabunny's CanvasSink):
   *  no extracted frames, and unlike <video> seeking every render frame i gets source frame
   *  i -- the property a channel that must stay in sync with another channel depends on. */
  video?: string;
  /** Clockwise rotation applied while decoding (e.g. 90 for a file stored rotated left). */
  videoRotation?: 0 | 90 | 180 | 270;
  /** Size of the decoded frame handed to the raster (default: the track's own, after rotation).
   *  The raster samples a grid of a few hundred points, so 1080 wide is plenty for 4K output. */
  videoWidth?: number;
  videoHeight?: number;
  /** Digits of zero padding in `{i}` (default 5). */
  pad?: number;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  /** fft_frames.bin URL. Omit for a silent source: the analyser stays empty, every band 0. */
  fft?: string;
  /** Optional .synth.json project applied before the first frame. */
  project?: string;
  seed?: number;
  /** Start the active timeline at bar 0 (default true when the project has one). */
  playTimeline?: boolean;
  /** Stills mode (tools/copilot/stills.mjs): no frames / video; the driver calls
   *  `__ruttOffline.still({...})` once per look instead of `renderFrame(i)`. */
  stills?: boolean;
  /** Force a performance profile for the whole run (otherwise the window width picks one,
   *  and 'balanced' -- 768..1919 px -- silently turns chroma off and halves the bloom target). */
  profile?: PerformanceProfileId;
}

/** One still: a look, its picture, and how long to let it settle. */
export interface OfflineStill {
  /** Settings to apply the way a built-in preset loads (`settings.patch(presetPatch(...))`). */
  patch: Record<string, unknown>;
  /** URL of a source still (PNG/JPG), or null/absent for a look that brings its own picture
   *  (the Pattern Generator, enabled in `patch`). */
  image?: string | null;
  /** Seeds the render's chance for this still, so a still does not depend on the ones before it. */
  seed: number;
  /** Frames stepped before the capture (t = 0 .. (frames-1)/fps); feedback needs a few. */
  frames: number;
}

/**
 * Stills: every key a previous look touched goes back to its DEFAULTS value (and the
 * camera transform with it), then `patch` loads exactly as a built-in preset does.
 * Two `patch` calls on purpose: a gate that was on and stays on (feedbackEnabled) is
 * switched off and on again, which is what clears its history (Postfx `requestClear`).
 * Unknown or mistyped keys throw: the loader would drop them with only a console warning.
 * `touched` accumulates across calls.
 */
export function applyLook(settings: SettingsStore, patch: Record<string, unknown>, touched: Set<string>): void {
  const defaults = DEFAULTS as unknown as Record<string, unknown>;
  const reset: Record<string, unknown> = {};
  for (const k of [...touched, ...CAMERA_TRANSFORM_KEYS]) reset[k] = defaults[k];
  settings.patch(presetPatch(reset as Partial<Settings>));
  for (const k of Object.keys(patch)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, k)) throw new Error(`still: unknown setting "${k}"`);
  }
  const p = presetPatch(patch as Partial<Settings>) as Record<string, unknown>;
  for (const k of Object.keys(patch)) {
    if (!(k in p)) throw new Error(`still: setting "${k}" was rejected by the loader (wrong type?)`);
    touched.add(k);
  }
  settings.patch(p as Partial<Settings>);
}

/** Mean and max Rec. 709 luma (0..1) of RGBA pixels: lets a driver spot a blank look
 *  without decoding the PNG. */
export function lumaStats(px: Uint8Array): { mean: number; max: number } {
  let sum = 0, max = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += y;
    if (y > max) max = y;
  }
  return { mean: n ? sum / n / 255 : 0, max: max / 255 };
}

export interface OfflineDeps {
  settings: SettingsStore;
  fft: FFTAnalyzer;
  ruttEtra: RuttEtraScene;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  openProject: (text: string) => Promise<unknown>;
  playTimelineFromStart: () => boolean;
  /** Put the playing timeline at `seconds` (a render that starts mid-job, or skips). */
  seekTimeline: (seconds: number) => void;
  resize: () => void;
  /** One pass of main.ts's frame body with a fixed step. */
  step: (dt: number, t: number) => void;
  /** Pin a performance profile (overrides the per-layout choice). */
  setPerformanceProfile: (id: PerformanceProfileId) => void;
  /** Zero the clocks that accumulate dt (post-FX analog noise), so a still is independent of
   *  how many frames ran before it. */
  resetClocks: () => void;
}

let renderTimeMs = 0;

export function isOfflineRender(params: URLSearchParams): boolean {
  return params.get('render') === 'offline';
}

/** Call at module load, BEFORE any engine is constructed (they read the clock in their constructors). */
export function installOfflineClock(seed: number): void {
  useOfflineDeterminism(() => renderTimeMs, seed);
}

export function parseFftFrames(buf: ArrayBuffer): OfflineSpectrumSource & { fps: number; frameCount: number; setFrame(i: number): void } {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'RWFF' || dv.getUint32(4, true) !== 1) throw new Error('fft file: not RWFF v1');
  const fftSize = dv.getUint32(8, true);
  const sampleRate = dv.getUint32(12, true);
  const fps = dv.getUint32(16, true);
  const frameCount = dv.getUint32(20, true);
  const bins = fftSize / 2;
  const db = new Float32Array(buf, 24, frameCount * bins);
  const td = new Float32Array(buf, 24 + frameCount * bins * 4, frameCount * fftSize);
  let cur = 0;
  return {
    fftSize, sampleRate, fps, frameCount,
    setFrame(i: number) { cur = Math.min(Math.max(0, i), frameCount - 1); },
    frequency(out: Uint8Array, minDb: number, maxDb: number) {
      // Chrome's byte mapping: 255 * (dB - min) / (max - min), clamped, truncated.
      const scale = 255 / (maxDb - minDb);
      const base = cur * bins;
      for (let k = 0; k < out.length; k++) {
        const v = (db[base + k] - minDb) * scale;
        out[k] = v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
      }
    },
    timeDomain(out: Float32Array) {
      const base = cur * fftSize;
      const n = Math.min(out.length, fftSize);
      out.fill(0);
      out.set(td.subarray(base + fftSize - n, base + fftSize), out.length - n);
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The real GPU, or the reason this run is not trustworthy (SwiftShader / no debug info). */
function gpuString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
}

export async function startOfflineRender(jobUrl: string, d: OfflineDeps): Promise<void> {
  const job: OfflineJob = await (await fetch(jobUrl)).json();
  const fft = job.fft ? parseFftFrames(await (await fetch(job.fft)).arrayBuffer()) : null;
  if (fft && fft.fps !== job.fps) throw new Error(`fft file is ${fft.fps} fps, job is ${job.fps}`);

  if (job.project) await d.openProject(await (await fetch(job.project)).text());
  // The output size is the job's, at scale 1, whatever the project or this machine prefers.
  d.settings.set('renderResolutionId', 'custom');
  d.settings.set('renderResolutionCustomW', job.width);
  d.settings.set('renderResolutionCustomH', job.height);
  d.settings.set('renderScale', 1);
  if (job.profile) d.setPerformanceProfile(job.profile); // resizes
  d.resize();
  if (fft) d.fft.attachOfflineSpectrum(fft);

  const tex = new THREE.Texture();
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.flipY = false; // UNPACK_FLIP_Y is not applied to ImageBitmaps; decoded upright this reads right side up (checked against testsrc2 2026-10-18). mirrorH defaults ON: a patch sets it off for an unmirrored read
  const pad = job.pad ?? 5;
  let lastBitmap: ImageBitmap | null = null;
  if (job.stills ? !!(job.frames || job.video) : !job.frames === !job.video) {
    throw new Error(job.stills ? 'offline stills job: no frames / video (each still names its own image)'
      : 'offline job: give exactly one of frames / video');
  }

  // Video source: one decoder, consumed in presentation order. A render that starts at frame N
  // (or jumps) restarts the iterator at N's timestamp; each frame's timestamp is checked.
  type Wrapped = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number };
  let sink: { canvases(start?: number): AsyncGenerator<Wrapped, void, unknown> } | null = null;
  let frames: AsyncGenerator<Wrapped, void, unknown> | null = null;
  let nextVideoFrame = -1;
  if (job.video) {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.UrlSource(job.video), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`no video track in ${job.video}`);
    sink = new mb.CanvasSink(track, {
      width: job.videoWidth, height: job.videoHeight, fit: 'fill',
      rotation: job.videoRotation ?? 0, poolSize: 2,
    }) as unknown as typeof sink;
  }
  async function videoFrame(i: number): Promise<Wrapped> {
    const t = i / job.fps;
    if (!frames || i !== nextVideoFrame) frames = sink!.canvases(t);
    nextVideoFrame = i + 1;
    for (;;) {
      const r = await frames.next();
      if (r.done) throw new Error(`video ended before frame ${i} (t=${t.toFixed(3)} s)`);
      const dt = r.value.timestamp - t;
      if (dt < -0.5 / job.fps) continue; // a frame before i (only at a restart): skip it
      if (dt > 0.5 / job.fps) throw new Error(`frame ${i}: decoder gave t=${r.value.timestamp.toFixed(4)}, wanted ${t.toFixed(4)}`);
      return r.value;
    }
  }
  const timeline = !job.stills && job.playTimeline !== false ? d.playTimelineFromStart() : false;
  let nextFrame = 0;

  /** The frame just drawn: PNG (base64) + SHA-256 of the raw RGBA pixels. */
  async function capture(): Promise<{ png: string; sha256: string; px: Uint8Array }> {
    const gl = d.renderer.getContext();
    const px = new Uint8Array(d.canvas.width * d.canvas.height * 4);
    gl.readPixels(0, 0, d.canvas.width, d.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const png = await new Promise<Blob>((res, rej) => d.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    return { png: toBase64(new Uint8Array(await png.arrayBuffer())), sha256: await sha256Hex(px), px };
  }

  // Stills: source images decoded once each (a set uses a handful), one texture re-pointed per still.
  const stillImages = new Map<string, ImageBitmap>();
  const touched = new Set<string>();
  async function still(s: OfflineStill): Promise<{ png: string; sha256: string; stats: { mean: number; max: number } }> {
    if (!job.stills) throw new Error('still() needs a job with "stills": true');
    if (!(s.frames >= 1)) throw new Error(`still: frames must be >= 1 (got ${s.frames})`);
    applyLook(d.settings, s.patch, touched);
    let bmp: ImageBitmap | null = null;
    if (s.image) {
      bmp = stillImages.get(s.image) ?? null;
      if (!bmp) {
        const r = await fetch(s.image);
        if (!r.ok) throw new Error(`still: image ${s.image}: HTTP ${r.status}`);
        bmp = await createImageBitmap(await r.blob(), { imageOrientation: 'from-image', colorSpaceConversion: 'none' });
        stillImages.set(s.image, bmp);
      }
      tex.image = bmp;
      tex.needsUpdate = true;
    }
    installOfflineClock(s.seed);
    d.resetClocks();
    for (let i = 0; i < s.frames; i++) {
      if (bmp) d.ruttEtra.setExternalVideoTexture(tex, bmp.width, bmp.height);
      renderTimeMs = (i / job.fps) * 1000;
      d.step(1 / job.fps, i / job.fps);
    }
    const { png, sha256, px } = await capture();
    return { png, sha256, stats: lumaStats(px) };
  }

  (window as unknown as { __ruttOffline: unknown }).__ruttOffline = {
    job,
    gpu: gpuString(d.renderer),
    timeline,
    size: () => [d.canvas.width, d.canvas.height],
    async renderFrame(i: number): Promise<{ png: string; sha256: string }> {
      if (job.stills) throw new Error('renderFrame() on a stills job: use still()');
      let bmp: ImageBitmap | null = null;
      if (job.video) {
        const w = await videoFrame(i);
        tex.image = w.canvas;
        tex.needsUpdate = true;
        d.ruttEtra.setExternalVideoTexture(tex, w.canvas.width, w.canvas.height);
      } else {
        const src = Math.min(i, job.frameCount - 1) + 1;
        const blob = await (await fetch(job.frames!.replace('{i}', String(src).padStart(pad, '0')))).blob();
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none' });
        tex.image = bmp;
        tex.needsUpdate = true;
        d.ruttEtra.setExternalVideoTexture(tex, bmp.width, bmp.height);
      }
      fft?.setFrame(i);
      renderTimeMs = (i / job.fps) * 1000;
      // The timeline advances by dt each step; a render that starts at frame N (or jumps)
      // seeks it so frame N shows what it shows in a full render.
      if (timeline && i !== nextFrame) d.seekTimeline(i / job.fps);
      nextFrame = i + 1;
      d.step(1 / job.fps, i / job.fps);
      lastBitmap?.close();
      lastBitmap = bmp;
      const { png, sha256 } = await capture();
      return { png, sha256 };
    },
    still,
    profile: job.profile ?? null,
  };
  document.title = 'ready';
}
