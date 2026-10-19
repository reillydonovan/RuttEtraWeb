# Rutt/Etra Web

A browser recreation of the **Rutt/Etra Scan Processor**, the analog video synthesizer Steve Rutt and Bill Etra built in New York in 1973. Feed it a webcam, a video file, a screen or a built-in pattern, and every scan line is pushed into depth by the brightness under it: a flat picture becomes a landscape drawn in light.

Everything runs in the browser. There is no backend, nothing to install, and the build is a folder of static files.

**Try it:** [ruttetraweb.com](https://ruttetraweb.com) · **Manual:** [ruttetraweb.com/about.html](https://ruttetraweb.com/about.html) · **Video course:** [ruttetraweb.com/tutorials.html](https://ruttetraweb.com/tutorials.html)

---

## What it does

- **The original control set.** Every knob from the [Rutt Electrophysics brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) is a live control: position and size, Z push, beam intensity and focus, rotation and spin, scan rate, H/V linearity, luminance threshold, contrast and gamma. A second raster (Dual Raster) can be woven in line by line.
- **Sources.** Webcam, screen capture, video files, HLS stream URLs, and a 16-pattern generator for when there's no camera. Two video sources can be composited before the scan processor.
- **Modulation, two ways.** A hardware-style four-slot function-generator matrix (*Classic*), and a node graph with ~50 node types (*Graph*). Both can run at once. Modulation never changes the value a knob shows; it layers on top and lets go cleanly.
- **A patchable faceplate.** The Patch Bay lays the whole instrument out as modules with jacks. Drag cables from oscillators, audio, MIDI or another parameter's output into any input.
- **Timeline.** Scenes and per-parameter keyframe lanes, including the virtual camera, with the BPM shared by every clock in the app.
- **Inputs from anywhere.** Web MIDI (with Learn), multi-band FFT audio and beat detection, OSC over WebSocket, gamepads, control voltage through DC-coupled audio interfaces, and an [MCP](https://modelcontextprotocol.io) bridge so an AI agent can play it.
- **Outputs.** Recording with WebCodecs (H.264 High / VP9 / AV1) and a MediaRecorder fallback, still photos, WebRTC share links with a QR code, WHIP streaming to OBS/MediaMTX, WebXR, anaglyph and side-by-side stereo, CV out and sonification (both off until you turn them on, with a safety stack).
- **Workspace.** Dockable, tabbed windows (Controls, Renderer, Patch Bay, Timeline), popouts for a second display, a Modern and a Classic theme, and a phone layout built like a camera app.
- **Projects.** Save the whole workspace as a `.synth.json`, a look as a preset, or a score as a timeline. Every saved format is versioned and migrated on load.

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/reillydonovan/RuttEtraWeb.git
cd RuttEtraWeb
npm install
npm run dev
```

Open **http://localhost:5190** and pick a source on the intro screen. **Pattern** needs no camera.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5190 (also reachable on your LAN) |
| `npm run build` | Typecheck, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` on port 4190 |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | TypeScript only |

`dist/` is plain static files, so you can host it on GitHub Pages, Netlify, any web server or a USB stick. The optional **Load Sample Video** button looks for `public/samples/sample.mp4` (or `VITE_SAMPLE_VIDEO_URL`, see [`.env.example`](.env.example)) and hides itself if there's no file.

### Debugging

- `?debug=mod` overlays each modulated parameter's base value, live value and difference.
- `?reset` backs up and clears saved local state, then reloads (for a session that won't start).
- `?view=<peerId>` is the fullscreen viewer a share link opens.

## Browser support

Desktop Chrome or Edge is the main target, and every feature works there. Firefox and Safari run the core synth, camera, recording and sharing; Web MIDI isn't available in Safari, and tab-audio capture is limited outside Chromium. The phone layout is tested in emulation and should be considered early.

## Companion tools

These live under `tools/`, each with its own `package.json` and README. None of them is needed to run the synth.

| Folder | What it is |
|---|---|
| [`tools/osc-bridge`](tools/osc-bridge/README.md) | UDP ↔ WebSocket bridge so the browser can talk OSC to TouchOSC, Max, SuperCollider |
| [`tools/mcp-server`](tools/mcp-server/README.md) | MCP server that relays an AI client's tool calls to the open app |
| [`tools/cv-bridge`](tools/cv-bridge/README.md) | Reference Python scripts: Raspberry Pi ADCs → OSC |
| [`tools/tutorials`](tools/tutorials/README.md) | The pipeline that records the video course (Playwright tours + TTS + ffmpeg) |

## How the code is organised

Vite and vanilla TypeScript, no UI framework; [three.js](https://threejs.org/) for WebGL. The parts you'll meet first:

| Path | What's there |
|---|---|
| `src/main.ts` | Entry point; boots the synth or the viewer |
| `src/state/Settings.ts` | Every user-facing parameter, its defaults, and the versioned `migrateSettings()` |
| `src/modulation/` | `LiveValues` (base + modulation → live), the Classic `ModMatrix`, and the node-graph engine in `graph/` |
| `src/renderer/` | The scan-line mesh and shaders, post-FX, camera, pattern generator, XR and stereo |
| `src/ui/` | The control panel, Patch Bay, timeline, graph editor, workspace windows and themes |
| `src/audio/`, `src/io/` | FFT, beat detection, CV in/out, sonification; MIDI/OSC/gamepad/MCP wiring |
| `src/project/` | Project, preset and timeline files, autosave and recovery |
| `docs/about/` | The manual, as Markdown, rendered into `about.html` at build time |
| `docs/design/` | Design notes for the larger features |

One rule shapes most of the code: a parameter has a **base** value (what the knob shows and what's saved) and a **live** value (base plus modulation, which the renderer reads), and nothing but the user writes the base. The project's nine design principles are written up in [`PRINCIPLES.md`](PRINCIPLES.md). [`CLAUDE.md`](CLAUDE.md) is the working notes kept for AI-assisted development, including a running log of what changed and why.

Release notes are in [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Bug reports, ideas and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## How it was made

Rutt/Etra Web was built with AI assistance (Claude), working from the original hardware documentation (the brochure, the manual and the panel diagram). A person directed every decision and tested the results.

## Credits

Original hardware: **Steve Rutt and Bill Etra**, Rutt Electrophysics, New York, 1973. The instrument's control set comes from the [Rutt/Etra Video Synthesizer brochure](https://vasulka.org/archive/Artists5/Rutt-E/VidSynthCont.pdf) in the Vasulka archive.

Built on [three.js](https://threejs.org/), [PeerJS](https://peerjs.com/), [hls.js](https://github.com/video-dev/hls.js), [Mediabunny](https://mediabunny.dev/), [qrcode](https://github.com/soldair/node-qrcode), [marked](https://marked.js.org/), [Vite](https://vitejs.dev/) and [Vitest](https://vitest.dev/); fonts VT323 and Share Tech Mono via [Fontsource](https://fontsource.org/) (SIL Open Font License). Full acknowledgements are in the manual.

## License

Copyright © 2026 Reilly Donovan.

Rutt/Etra Web is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, study, change and share it. If you run a modified version for other people, including as a website, you must offer them its source code under the same license.
