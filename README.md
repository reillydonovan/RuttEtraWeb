# Rutt/Etra Web Synthesizer

A browser-based recreation of the **Rutt/Etra Scan Processor** — the legendary 1973 analog video synthesizer designed by Steve Rutt and Bill Etra. This implementation runs entirely in the browser with no backend required. Feed it a webcam, a video file, or your screen, and it renders the iconic scan-line effect where scan lines are displaced along the Z axis in proportion to the brightness of each pixel.

---

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and click **REQUEST WEBCAM**.

## Build for production

```bash
npm run build
```

`dist/` is fully static — deploy to GitHub Pages, Netlify, Vercel, or any static host with no server configuration needed.

---

## Features

### Video sources
- **Webcam** — pick any attached camera from a device dropdown. Click *Refresh* after granting camera permission to see correct device labels.
- **Screen capture** — use `getDisplayMedia` to synthesize a window, tab, or entire display.
- **Video file** — drag a file onto the picker to loop local video through the effect.
- Mirror H / Mirror V toggles apply before synthesis.

### Display Control Unit — full native Rutt/Etra control set

Every knob from the original [Rutt Electrophysics hardware brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) is implemented as a live shader uniform:

| Group | Controls |
|---|---|
| **Position & Size** | H Position, V Position, H Size (bipolar — negative inverts), V Size (bipolar), Aspect |
| **Depth** | Z Push, Z Bias, Z Invert |
| **Beam** | Intensity, Focus (0 = sharp → 1 = soft 5-tap blur) |
| **Rotation** | H Center, V Center, H Spin, V Spin, H/V Spin Rate (auto-rotation), H Reverse, V Reverse, Display 0°/90° |
| **Scan** | Scan Rate (rows), Cols (samples per row), Skip/Underscan (drop fraction of lines) |
| **Linearity** | H Linearity, V Linearity (pin-cushion / barrel bow) |
| **Luminance** | Threshold, Contrast, Gamma |

### Modulation system

Emulates the original Ramp Generator, Waveform Generator (oscillator), Audio Interface, and Joystick modules. Four independent slots can each target any DCU or post-FX parameter:

- **Sources** — Sine, Triangle, Square, Saw, Pulse (with duty cycle), Ramp (up / down / triangle / hold), Audio (mic envelope follower), Joystick X / Y / Z
- **Routing** — any source → any target; multiple slots can sum into the same target (matching the hardware Summing Amplifier)
- **Joystick pad** — click-and-drag 2D pad in the Modulation panel, scroll wheel for Z axis
- **Mic envelope follower** — enable once with the *Enable Mic* button; follow the beat, melody, or any audio input

### Free-flight 3D camera

| Mode | Controls |
|---|---|
| **Orbit** (default) | Left-drag = rotate · Right-drag = pan · Scroll = zoom |
| **Fly** | Click canvas to lock pointer → `W/A/S/D` move · `Space/Ctrl` up/down · `Q/E` roll · `Shift` boost · `Esc` release |

- FOV, near, and far plane sliders — clip *into* the geometry intentionally
- **Auto-orbit** — slow hands-free camera spin around the raster
- **R** key or *Reset View* button — snaps back to saved default
- **Save Default View** — captures the current camera as the new reset target; persists across reloads and is included in preset exports

### Color & post-processing

- **Color modes** — Grayscale · Phosphor Green (P1) · Phosphor Amber · Custom Tint · Sampled Video
- **Background color** picker
- **Bloom** (UnrealBloomPass) — intensity, radius, threshold
- **Scanline overlay** — intensity, density
- **Chromatic aberration** — radial RGB split
- **Vignette** — edge darkening
- **Burn-in feedback** — accumulation buffer with decay; produces the long-exposure phosphor-trail look of an aging CRT

### Presets

Seven built-in presets load with a single click. Each captures all DCU, color/FX, and camera default view settings:

| Preset | Description |
|---|---|
| Classic 1974 | White scan lines on black, modest bloom — the original look |
| Phosphor Green | Soft P1 green glow, heavy bloom |
| Amber Terminal | Warm amber phosphor with heavy scanline grid |
| Wireframe | Sampled video color, no bloom — readable terrain mesh |
| Heavy Bloom | Deep haze, high contrast, dramatic glow |
| Burn-In | Long-exposure feedback trails |
| Diving | Camera tucked inside the raster in fly mode |

**User presets** can be saved (named, stored in `localStorage`) and exported/imported as JSON files.

### Recording

In the *Record* section:

1. Choose format (*Auto* picks the best available codec: MP4/H.264 → WebM/VP9 → WebM/VP8)
2. Set FPS and bitrate
3. Optionally toggle **Include Mic** to capture narration
4. Click **Start Recording** — a live timer shows elapsed time
5. Click **Stop & Download** — file downloads with a timestamped filename

### Streaming (WebRTC P2P)

In the *Share* section:

1. Click **Start Broadcast** — a share URL and QR code appear immediately
2. Open that URL on any other browser or device to view the live synthesized output fullscreen with no UI
3. The viewer page reconnects automatically if the connection drops
4. Click **Stop** to end the broadcast

> Uses the public [PeerJS broker](https://peerjs.com) for WebRTC signaling. No server setup required. For reliable production use, run your own:
> ```bash
> npx peerjs --port 9000 --key yourkey
> ```
> Then update the `new Peer()` call in `src/stream/Broadcaster.ts` to point at it.

---

## Project structure

```
src/
├── main.ts                     entry — routes synth vs ?view=<id> (viewer mode)
├── state/Settings.ts           typed params store, subscribe/notify, localStorage
├── input/sources.ts            webcam / screen / file source manager
├── renderer/
│   ├── RuttEtra.ts             scene, LineSegments grid, ShaderMaterial, render loop
│   ├── CameraRig.ts            Orbit + Fly modes, FOV, reset/save view
│   ├── Postfx.ts               EffectComposer: feedback, bloom, CRT pass
│   └── shaders/
│       ├── ruttEtra.vert.glsl  full DCU vertex pipeline
│       └── ruttEtra.frag.glsl  color modes + intensity + alpha falloff
├── modulation/ModMatrix.ts     Ramp, Waveform, AudioFollower, Joystick, routing
├── record/Recorder.ts          MediaRecorder wrapper, codec detection, download
├── stream/
│   ├── Broadcaster.ts          PeerJS broadcaster + QR share URL
│   └── Viewer.ts               ?view=<id> fullscreen viewer with auto-reconnect
└── ui/
    ├── ControlPanel.ts         collapsible dock-able panel shell
    ├── widgets.ts              reusable form controls (slider, toggle, dropdown…)
    ├── panel.css               retro CRT theme — VT323 font, glow, scanlines
    ├── presets.ts              built-in preset definitions
    └── sections/               one file per panel section
        ├── SourceSection.ts
        ├── DcuSection.ts
        ├── ModulationSection.ts
        ├── CameraSection.ts
        ├── ColorPostFxSection.ts
        ├── GeometrySection.ts
        ├── PresetsSection.ts
        ├── RecordSection.ts
        └── ShareSection.ts
```

---

## Technology

- [Vite](https://vitejs.dev/) + vanilla TypeScript — no framework, fully static output
- [three.js](https://threejs.org/) — WebGL rendering, EffectComposer, OrbitControls, PointerLockControls
- [PeerJS](https://peerjs.com/) — WebRTC signaling (zero backend)
- [qrcode](https://www.npmjs.com/package/qrcode) — QR code generation for share URLs
- Browser APIs — `getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `MediaRecorder`, `captureStream`, Web Audio API

---

## Out of scope (for now)

- RTMP push to YouTube / Twitch (requires an ffmpeg backend bridging WebRTC → RTMP)
- Virtual webcam output for OBS / Zoom (requires a native helper app)
- Mobile-first layout (works on large tablets; desktop is the primary target)
- Audio-reactive modulation with beat detection (the mic follower in the modulation system is a good starting point)

---

## Credits

Original hardware design: **Steve Rutt & Bill Etra**, Rutt Electrophysics, New York, 1973.

Control set documentation sourced from the [Rutt/Etra Video Synthesizer brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) in the Vasulka archive.
