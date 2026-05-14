# Rutt/Etra Web Synthesizer

A browser-based recreation of the **Rutt/Etra Scan Processor** — the legendary 1973 analog video synthesizer designed by Steve Rutt and Bill Etra. This implementation runs entirely in the browser with no backend required. Feed it a webcam, a video file, or your screen, and it renders the iconic scan-line effect where scan lines are displaced along the Z axis in proportion to the brightness of each pixel.

It also speaks **Web MIDI**, **multi-band FFT audio reactivity**, and **OSC over WebSocket** out of the box.

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

## Recent changes (v9)

**May 2026** — Base/live split architecture + modulation UX improvements:

- **Fixed: "sticky parameters" bug** — When modulation drops to zero (amount → 0, patch disabled, or source signal silent), params now snap back to their user-edited base value instantly. Previously they stuck at their last modulated value indefinitely.
- **Architecture**: Introduced `LiveValuesStore` with separate **base** (what the UI knob shows) and **live** (what the renderer reads) values. Engines push per-frame contributions; renderer subscribes to live values. UI continues reading/writing base values via `Settings`. This is the canonical "base + mod" pattern used by every modulation-capable synth.
- **Per-row Reset (↻) buttons** — Click to reset a patch's params to type-defaults while keeping routing. Shift+click for hard reset (also wipes Source + Target back to defaults). Keyboard: `R` / `Shift+R`.
- **Global "Reset Mod" button** — Mutes every patch (Amount → 0) and snaps all modulated params back to base in one tick. The panic button for complex routings.
- **`?debug=mod` overlay** — Live readout of `base / live / Δ` for every modulated param. Essential for verifying the base/live split is working correctly.
- **Graph patch Amount range increased** — Now ±20 (was ±5) for extreme parameter sweeps.
- **97 unit tests** — New `LiveValues.test.ts` pins down "amount=0 → live==base", "binding removed → live==base", multi-namespace summing, etc. Engine tests updated to verify both engines honor the base/live contract.

---

## Features

The control panel is split into two tabs:

- **Synth** — the original scan-processor: source, DCU, camera, color, post-FX, modulation, geometry, presets, record, share.
- **I/O** — MIDI, Audio (FFT), OSC. New in v2.

### Video sources
- **Webcam** — pick any attached camera from a device dropdown. Click *Refresh* after granting camera permission to see correct device labels.
- **Screen capture** — use `getDisplayMedia` to synthesize a window, tab, or entire display.
- **Video file** — drag a file onto the picker to loop local video through the effect.
- Mirror H / Mirror V toggles apply before synthesis. Both default to on so webcam input feels right immediately.

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

Two parallel modulation engines run alongside each other — **Classic** (4-slot matrix) and **Graph** (signal-graph patching). Pick one, or run both simultaneously. v9 introduces a **base/live split** architecture that fixes the long-standing "sticky parameter" bug: when modulation drops to zero or a patch is disabled, params now snap back to their user-edited base value instantly instead of sticking at their last modulated value.

#### Classic mode — Hardware-style 4-slot matrix

Emulates the original Ramp Generator, Waveform Generator (oscillator), Audio Interface, and Joystick modules. Four independent slots can each target any DCU or post-FX parameter:

- **Sources** — Sine, Triangle, Square, Saw, Pulse (with duty cycle), Ramp (up / down / triangle / hold), Audio (envelope), Audio Band [n], Beat, MIDI CC, MIDI Note, MIDI Velocity, MIDI Clock, OSC, Joystick X / Y / Z, Constant
- **Routing** — any source → any target; multiple slots sum into the same target (matching the hardware Summing Amplifier)
- **Per-slot controls** — expandable rows expose source-specific params (LFO Rate / Phase / Duty / Depth, Ramp Time, Audio Gain, etc.) plus an output stage (Curve / Range / Offset / Invert) that shapes the signal before it hits the target
- **Clock Sync** — when on, the slot's frequency slider is replaced by a Division dropdown (`1/1 1/2 1/4 1/8 1/16 1/32` plus dotted and triplet variants). Tempo is taken from incoming MIDI clock or the shared internal BPM.
- **MIDI Out** — each slot can additionally emit its current value as a CC on a chosen channel/CC pair, turning the synth into a modulation source for external gear
- **Joystick pad** — click-and-drag 2D pad in the Modulation panel, scroll wheel for Z axis

#### Graph mode — Signal-graph modulation

Inspired by the original Rutt/Etra's voltage-control philosophy: every signal is a normalized scalar (-1..1 by convention, unbounded in practice), and signals can be processed, mixed, multiplied, and chained arbitrarily before reaching a param target:

- **Beginner view** — looks identical to Classic mode; expandable rows with source/amount/target and inline controls. The backing model is a full signal graph; edits in Beginner view are non-destructive projections — switching to Advanced view reveals the underlying nodes.
- **Advanced view** — node-and-cable editor (double-click canvas to add nodes, drag ports to wire). Ships with ~40 node types spanning sources (LFO, Clock, MIDI, OSC, Video luma, Audio FFT), processors (Mix, Multiply, Curve, Slew, Delay, S&H, Logic, Math), and a special Output node that binds the graph's result to Settings params.
- **Amount range** — Graph patches support ±20 modulation depth (Classic is ±5) for extreme parameter sweeps.
- **Patch library** — save named graph patches to `localStorage`; export/import as JSON.

#### Common features (both modes)

- **Per-row Reset (↻)** — click to reset a patch's params to type-defaults (LFO Rate → 1 Hz, Shape → Sine, Amount → 0, output stage → identity) while keeping Source + Target. Shift+click for **hard reset** (also wipes Source → Sine LFO and Target → "none"). Keyboard: `R` / `Shift+R` when row is focused.
- **Global "Reset Mod"** — button at the top of the Modulation panel mutes every patch (Amount → 0) and forces all modulated params back to base in one tick. The patches stay configured — this is the "panic button" for when a complex routing gets out of hand.
- **Copy / Paste** — per-row clipboard with format-aware serialization (Classic slots and Graph beginner rows use compatible snapshots).
- **`?debug=mod` overlay** — append `?debug=mod` to the URL to see a live readout of every modulated param's `base / live / Δ` values. Updates at 30 Hz. Essential for verifying the base/live split is working correctly.

### MIDI (I/O tab)

- **Web MIDI** device pickers for input and output, persisted across sessions and auto-reattached on USB reconnect.
- **MIDI clock receiver** with a smoothed BPM readout and a flashing beat indicator. Handles 24-PPQ, start/stop/continue, and exposes `phase01` / `beatPulse` to the modulation matrix.
- **Learn table** — click *Learn*, wiggle a knob on your controller, drop the resulting binding into any Settings target with a curve (linear / exp / log / inverted) and min/max range.
- **14-bit CC** is supported — pair an MSB CC with its LSB partner (CC + 32 by default) for 16384-step resolution.
- **MIDI Out** — driven by the per-slot config in the Modulation section.
- Safari falls back to a polite "Web MIDI not available" notice — the rest of the app keeps working.

### FFT audio reactivity (I/O tab)

- **Inputs** — microphone, audio file (drag-drop with built-in transport + loop toggle), or tab/system audio capture.
- **Configurable** FFT size (512–4096), band count (8–128), and band spacing (linear / logarithmic / mel).
- **Per-band attack/release/gain/floor/threshold** smoothing, applied frame-aware.
- **Live visualizer** drawn on a small `<canvas>` showing every band in real time.
- **Spectrum -> Z displacement** routing — the band array is uploaded as a `RedFormat`/`FloatType` `DataTexture` each frame; the vertex shader samples it per row, adding a per-band Z term so audio literally pushes scan lines into the screen. Tunable amount and stride.
- **Beat detector** — spectral flux on the bass bands with an adaptive threshold and a decaying pulse, exposed as the `beat` mod source.
- **Monitor** toggle (off by default, with a feedback warning) routes the analyzed signal to your speakers.

The original `audio` mod source is preserved — it now reads `FFTAnalyzer.getEnvelope()` so existing presets and slots keep working unchanged.

### OSC bridge (I/O tab)

- **WebSocket client** in the browser; **UDP &harr; WebSocket bridge** in `tools/osc-bridge/`.
- The bridge is a tiny Node script (`node-osc` + `ws`) that translates each OSC packet to JSON and back. See [`tools/osc-bridge/README.md`](tools/osc-bridge/README.md) for protocol details and TouchOSC / Max / SuperCollider examples.
- **Learn table** identical to the MIDI side — click *Learn*, send a message from TouchOSC, target picker fills in.
- **Auto-reconnect** with exponential backoff (1 s → 30 s) so unplugging and replugging the bridge is painless.
- **Copy TouchOSC layout** button generates a starter JSON listing one fader per binding and copies it to your clipboard.

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
- **Bloom** (UnrealBloomPass) — intensity, radius, threshold. Off by default in v2 to keep raw scan lines crisp; flip it on for the classic glow.
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

**User presets** can be saved (named, stored in `localStorage`) and exported/imported as JSON files. The format is versioned (`_v: 2`) and v1 presets are auto-migrated on load — old files keep working, missing v2 fields are filled with sensible defaults.

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

## OSC bridge quick start

```bash
cd tools/osc-bridge
npm install
npm run dev          # runs server.ts via tsx, no build step
```

Default ports: UDP `8000` in (from your controller), UDP `9000` out (back to your controller), WebSocket `8080` (the synth). Override with `UDP_IN_PORT`, `UDP_OUT_HOST`, `UDP_OUT_PORT`, `WS_PORT` env vars.

In the synth's **I/O &rarr; OSC** panel, set the bridge URL to `ws://localhost:8080` and click **Connect**.

---

## Project structure

```
src/
├── main.ts                     entry — routes synth vs ?view=<id> (viewer mode)
├── state/Settings.ts           typed params store, subscribe/notify, localStorage, v2 migration
├── input/sources.ts            webcam / screen / file source manager
├── renderer/
│   ├── RuttEtra.ts             scene, LineSegments grid, ShaderMaterial, spectrum DataTexture
│   ├── CameraRig.ts            Orbit + Fly modes, FOV, reset/save view
│   ├── Postfx.ts               EffectComposer: feedback, bloom, CRT pass
│   └── shaders/
│       ├── ruttEtra.vert.glsl  full DCU vertex pipeline + spectrum-driven Z term
│       └── ruttEtra.frag.glsl  color modes + intensity + alpha falloff
├── modulation/
│   ├── ModMatrix.ts            Classic 4-slot engine: Ramp, LFO, FFT, Beat, MIDI/OSC sources, MIDI-out
│   ├── LiveValues.ts           base/live split store — fixes "sticky params" when modulation stops
│   ├── ModDebugOverlay.ts      ?debug=mod overlay showing base/live/Δ per param
│   ├── outputStage.ts          shared curve/invert/range/offset shaping (used by both engines)
│   └── graph/
│       ├── GraphEngine.ts      signal-graph engine: compile, topology sort, per-frame tick
│       ├── types.ts            GraphPatch, GraphNode, TargetBinding, NodeDef interfaces
│       ├── registry.ts         node type registry + getDef() lookup
│       ├── bootstrap.ts        auto-registers all node definitions at import time
│       ├── nodes/              ~40 node implementations (sources, processors, logic, video, audio)
│       ├── VideoTap.ts         per-frame video texture luminance sampler (Video CV nodes)
│       ├── BeginnerView.ts     beginner UI — looks like Classic, backed by graph
│       ├── AdvancedView.ts     node-and-cable editor (SVG canvas, drag-to-wire)
│       └── library.ts          graph patch save/load/export (localStorage + JSON)
├── midi/
│   ├── MidiManager.ts          requestMIDIAccess, device pickers, sendCC (7- and 14-bit)
│   ├── MidiMapping.ts          binding registry, learn(), curves, last-value cache
│   └── MidiClock.ts            24-PPQ clock receiver, bpm + phase + beatPulse + divisionToHz
├── audio/
│   ├── FFTAnalyzer.ts          AnalyserNode wrapper, banding (linear/log/mel), per-band smoothing
│   └── BeatDetector.ts         spectral flux on bass bands, adaptive threshold
├── osc/OscClient.ts            WebSocket OSC client, learn(), auto-reconnect
├── record/Recorder.ts          MediaRecorder wrapper, codec detection, download
├── stream/
│   ├── Broadcaster.ts          PeerJS broadcaster + QR share URL
│   └── Viewer.ts               ?view=<id> fullscreen viewer with auto-reconnect
└── ui/
    ├── ControlPanel.ts         collapsible dock-able panel shell with Synth / I/O tabs
    ├── widgets.ts              reusable form controls (slider, toggle, dropdown…)
    ├── widgets/
    │   └── LearnBinding.ts     shared learn-table primitive used by MIDI + OSC
    ├── shared/
    │   └── SlotRow.ts          shared expandable modulation row component (Classic + Graph beginner)
    ├── targets.ts              shared list of routable Settings keys
    ├── panel.css               retro CRT theme — VT323 font, glow, scanlines, tab strip
    ├── presets.ts              built-in preset definitions
    ├── graph/
    │   ├── PatchSection.ts     Graph mode container (Beginner / Advanced tabs)
    │   ├── BeginnerView.ts     beginner-view rows (uses shared SlotRow.ts)
    │   ├── AdvancedView.ts     node editor canvas (SVG drag-and-wire)
    │   ├── inspector.ts        binding inspector panel (Advanced view)
    │   └── graph.css           graph-specific styles
    └── sections/               one file per panel section
        ├── SourceSection.ts
        ├── DcuSection.ts
        ├── ModulationContainerSection.ts  Classic/Graph/Both mode switch + Reset Mod button
        ├── ModulationSection.ts           Classic 4-slot UI (uses shared SlotRow.ts)
        ├── CameraSection.ts
        ├── ColorPostFxSection.ts
        ├── GeometrySection.ts
        ├── PresetsSection.ts
        ├── RecordSection.ts
        ├── ShareSection.ts
        ├── MidiSection.ts                 (I/O tab)
        ├── AudioSection.ts                (I/O tab)
        └── OscSection.ts                  (I/O tab)

tools/
└── osc-bridge/                 standalone Node workspace (own package.json)
    ├── package.json
    ├── server.ts               UDP <-> WebSocket OSC bridge
    └── README.md
```

---

## Technology

- [Vite](https://vitejs.dev/) + vanilla TypeScript — no framework, fully static output
- [three.js](https://threejs.org/) — WebGL rendering, EffectComposer, OrbitControls, PointerLockControls, DataTexture
- [PeerJS](https://peerjs.com/) — WebRTC signaling (zero backend)
- [qrcode](https://www.npmjs.com/package/qrcode) — QR code generation for share URLs
- Browser APIs — Web MIDI, Web Audio (`AnalyserNode`), `getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `MediaRecorder`, `captureStream`
- OSC bridge (separate workspace) — [node-osc](https://www.npmjs.com/package/node-osc) + [ws](https://www.npmjs.com/package/ws)

---

## Browser support

| Feature | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Core synth + camera + recording | ✅ | ✅ | ✅ |
| WebRTC streaming | ✅ | ✅ | ✅ |
| Web MIDI | ✅ | ⚠️ flag | ❌ (graceful fallback) |
| Tab audio capture | ✅ | ⚠️ partial | ❌ |
| Mic / file audio | ✅ | ✅ | ✅ |
| OSC bridge | ✅ | ✅ | ✅ |

---

## Out of scope (for now)

- RTMP push to YouTube / Twitch (requires an ffmpeg backend bridging WebRTC → RTMP)
- Virtual webcam output for OBS / Zoom (requires a native helper app)
- Mobile-first layout (works on large tablets; desktop is the primary target)

---

## Credits

Original hardware design: **Steve Rutt & Bill Etra**, Rutt Electrophysics, New York, 1973.

Control set documentation sourced from the [Rutt/Etra Video Synthesizer brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) in the Vasulka archive.
