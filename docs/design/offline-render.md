# Offline render mode

`?render=offline&job=<url>&seed=<n>`: a deterministic, frame-stepped render of a video
source through a saved patch, for music videos and reels where the output must be exact,
repeatable and not tied to real time. Live mode is unchanged: none of this runs unless the
URL asks for it.

## What makes it deterministic

| live input | offline replacement |
|---|---|
| `THREE.Clock` delta / elapsed | `dt = 1/fps`, `t = frame/fps`, passed into `frame(dt, t)` |
| `performance.now()` in `ModMatrix` (free LFO phase, ramps), `GraphEngine` (`timeSec`), `BeatDetector` | `nowMs()` from `src/platform/determinism.ts`, the render clock |
| `Math.random()` in the graph `noise` node | `random()`, seeded by `&seed=` |
| `AnalyserNode.getByteFrequencyData` / time domain | precomputed per-frame spectra (`fft_frames.bin`) fed through `FFTAnalyzer.attachOfflineSpectrum`; band grouping, smoothing, the beat detector and every consumer run unchanged |
| `<video>` + `VideoTexture` (seeking is approximate) | PNG frame `i` loaded by index, bound with `setExternalVideoTexture` |
| frame-rate cap, `FrameBudgetWatcher` quality adaptation | skipped: offline frames are slow by design |

The render clock and seed are installed at module load, before any engine is built,
because engines read the clock in their constructors.

## Driver

`tools/offline-render/render.mjs` (Playwright, headed Chrome) serves the built app
(`npm run build`) and the job's files by request interception at `http://localhost:5199`,
calls `window.__ruttOffline.renderFrame(i)` per frame, and pipes the returned PNGs to
ffmpeg. Each frame also returns a SHA-256 of its pixels.

- **Real GPU or nothing.** The run fails if WebGL reports a software renderer
  (SwiftShader, llvmpipe, Microsoft Basic Render).
- **ANGLE on OpenGL by default.** Measured on a 3090 Ti (2026-10-18), 60 frames
  rendered twice: OpenGL bit-identical; D3D11 (27/60 frames) and Vulkan (24/60) differ
  by ±1 in up to ~150 px a frame. It is not MSAA (identical result with antialias off).
  Override with `ANGLE=d3d11|vulkan`.
- **Determinism test:** `node render.mjs --job job.json --verify 60` renders twice in
  fresh browsers and compares every frame's hash; exit 1 on any difference.

## Job JSON

```json
{ "frames": "frames", "pad": 5, "frameCount": 1801, "fps": 30, "width": 1080, "height": 1350,
  "fft": "fft_frames.bin", "project": "patch.synth.json", "seed": 7, "playTimeline": true }
```

Paths are local, relative to the job file. `project` is a normal `.synth.json`, applied
with the usual migration and safety rules; the output size is then forced to the job's
(`renderResolutionId: custom`, `renderScale: 1`). `playTimeline` starts the active
timeline at bar 0 with loop off.

## fft_frames.bin

Little-endian: `"RWFF"`, u32 version 1, u32 fftSize, u32 sampleRate, u32 fps,
u32 frameCount; then frameCount × fftSize/2 f32 bin magnitudes in dBFS; then
frameCount × fftSize f32 time-domain samples. Each frame is what Chrome's AnalyserNode
holds at `t = i/fps`: the fftSize samples ending at t, stereo averaged to mono, Blackman
window, |X|/fftSize. dB → bytes happens in the app with the patch's own threshold, so
`audioThresholdDb` can change without a recompute; `audioFftSize` cannot (the render fails
naming both sizes). A generator: `RuttEtraWebNIN/pipeline/fft_precompute.py`.

## Stills (look copilot)

A job with `"stills": true` (no frames / video) renders one still per call instead of a
sequence: `__ruttOffline.still({ patch, image, seed, frames })` resets every key an earlier
still touched (and the camera transform) to its default, applies `patch` the way a built-in
preset loads (`settings.patch(presetPatch(...))`; unknown or mistyped keys throw), binds
`image` if given, reseeds chance, zeroes the post-FX clock, steps `frames` frames from t = 0
and returns the PNG, the pixel SHA-256 and mean/max luma. `"profile"` pins a performance
profile for any job (otherwise the window width picks one). Driver:
`tools/copilot/stills.mjs`; see `tools/copilot/README.md`.

## Not covered

Graph video nodes (`video-luma`, `video-motion`, ...) read the `<video>` element, which is
empty offline; they output nothing. MIDI, OSC, gamepad and CV inputs are live-only.
Stereo/XR/anaglyph output paths are untested offline.
