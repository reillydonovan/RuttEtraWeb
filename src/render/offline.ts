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
import type { SettingsStore } from '../state/Settings';
import type { RuttEtraScene } from '../renderer/RuttEtra';
import { useOfflineDeterminism } from '../platform/determinism';

export interface OfflineJob {
  /** Source frame URL with `{i}` = 1-based zero-padded index, e.g. `/reel/frames/{i}.png`. */
  frames: string;
  /** Digits of zero padding in `{i}` (default 5). */
  pad?: number;
  frameCount: number;
  fps: number;
  width: number;
  height: number;
  /** fft_frames.bin URL. */
  fft: string;
  /** Optional .synth.json project applied before the first frame. */
  project?: string;
  seed?: number;
  /** Start the active timeline at bar 0 (default true when the project has one). */
  playTimeline?: boolean;
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
  const fft = parseFftFrames(await (await fetch(job.fft)).arrayBuffer());
  if (fft.fps !== job.fps) throw new Error(`fft file is ${fft.fps} fps, job is ${job.fps}`);

  if (job.project) await d.openProject(await (await fetch(job.project)).text());
  // The output size is the job's, at scale 1, whatever the project or this machine prefers.
  d.settings.set('renderResolutionId', 'custom');
  d.settings.set('renderResolutionCustomW', job.width);
  d.settings.set('renderResolutionCustomH', job.height);
  d.settings.set('renderScale', 1);
  d.resize();
  d.fft.attachOfflineSpectrum(fft);

  const tex = new THREE.Texture();
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.flipY = false; // UNPACK_FLIP_Y is not applied to ImageBitmaps; decoded upright this reads right side up (checked against testsrc2 2026-10-18). mirrorH defaults ON: a patch sets it off for an unmirrored read
  const pad = job.pad ?? 5;
  let lastBitmap: ImageBitmap | null = null;
  const timeline = job.playTimeline !== false ? d.playTimelineFromStart() : false;
  let nextFrame = 0;

  (window as unknown as { __ruttOffline: unknown }).__ruttOffline = {
    job,
    gpu: gpuString(d.renderer),
    timeline,
    size: () => [d.canvas.width, d.canvas.height],
    async renderFrame(i: number): Promise<{ png: string; sha256: string }> {
      const src = Math.min(i, job.frameCount - 1) + 1;
      const blob = await (await fetch(job.frames.replace('{i}', String(src).padStart(pad, '0')))).blob();
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none' });
      tex.image = bmp;
      tex.needsUpdate = true;
      d.ruttEtra.setExternalVideoTexture(tex, bmp.width, bmp.height);
      fft.setFrame(i);
      renderTimeMs = (i / job.fps) * 1000;
      // The timeline advances by dt each step; a render that starts at frame N (or jumps)
      // seeks it so frame N shows what it shows in a full render.
      if (timeline && i !== nextFrame) d.seekTimeline(i / job.fps);
      nextFrame = i + 1;
      d.step(1 / job.fps, i / job.fps);
      lastBitmap?.close();
      lastBitmap = bmp;
      const gl = d.renderer.getContext();
      const px = new Uint8Array(d.canvas.width * d.canvas.height * 4);
      gl.readPixels(0, 0, d.canvas.width, d.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const png = await new Promise<Blob>((res, rej) => d.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      return { png: toBase64(new Uint8Array(await png.arrayBuffer())), sha256: await sha256Hex(px) };
    },
  };
  document.title = 'ready';
}
