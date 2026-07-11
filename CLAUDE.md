# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RuttEtraWeb is a browser-based recreation of the 1973 Rutt/Etra Scan Processor analog video synthesizer. It runs entirely client-side (no backend): webcam / screen / video-file / synthesized-pattern input → scan-line mesh displaced in Z by brightness → free-flight 3D camera, post-FX, recording, WebRTC/WHIP streaming, WebXR, and stereoscopic output. It speaks Web MIDI, multi-band FFT audio reactivity, OSC over WebSocket, gamepad, and bidirectional CV (control voltage) through DC-coupled audio interfaces.

Stack: Vite + vanilla TypeScript (no framework), three.js, PeerJS, hls.js, qrcode. GLSL shaders are imported as assets (`assetsInclude` in `vite.config.ts`). Fully static `dist/` output, deployed to Hostinger via FTP on push to `main` (`.github/workflows/deploy.yml`). PWA/service-worker support was deliberately removed (stale-cache problems); `public/sw.js` is a kill-switch that unregisters old installs — do not reintroduce a service worker.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # tsc --noEmit && vite build
npm run typecheck    # tsc --noEmit only
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
npx vitest run src/project/__tests__/Project.test.ts   # single test file
npx vitest run -t "pattern of test name"               # by test name
node scripts/check-about-bundle.cjs   # after build: assert about page has no synth runtime
```

`tools/osc-bridge/` is a separate Node workspace with its own `package.json` (`npm install && npm run dev` inside it) — a UDP↔WebSocket bridge so the browser can talk OSC to TouchOSC/Max/SuperCollider. `tools/cv-bridge/` holds reference Python scripts (Raspberry Pi ADCs → OSC).

### Testing conventions

Vitest runs in the `node` environment with an explicit `include` allowlist in `vitest.config.ts` — only pure, DOM-free modules are tested (no three.js/WebGL mocking). **If you add tests in a new directory, you must add its glob to that allowlist or the tests silently won't run.** For DOM-dependent tests, declare `// @vitest-environment jsdom` at the top of the file (see `src/renderer/__tests__/XRManager.test.ts`).

## Design principles (mandatory)

`.cursor/rules/principles.mdc` is the directive form of nine project principles; `PRINCIPLES.md` is the long-form reference; `docs/about/02-design-principles.md` is the artist-facing version. All three cover the same nine principles in the same order. Treat them as constraints, and surface conflicts with user requests rather than silently working around them. The most operationally important:

1. **One concept, one authoritative source.** `Settings.internalBpm` is THE bpm (Classic LFOs, Timeline, Graph clock nodes all read it). `PARAM_DOCS` (`src/ui/help/paramDocs.ts`) drives both in-app Help and the About page's Param Reference. The graph node registry (`src/modulation/graph/registry.ts`) drives both runtime and the auto-generated Node Catalog. `migrateSettings()` is the single migration entry point. `ResolutionManager` is the single sizing authority. Before adding state, search for the existing concept.

2. **Base/live split.** Every modulatable parameter has a base value (what the UI knob shows; `Settings.get/set`) and a live value (what the renderer reads; `liveValues.get(key)`). UI writes base only; modulation engines write contributions to `LiveValuesStore` only; shaders read live only. **Never** `settings.set(key, liveValue)` from any modulation lifecycle — that's the pre-v9 "sticky param" bug.

3. **No silent fallbacks.** If a configured mode's prerequisite is missing (MIDI clock absent, device disconnected, AC-coupled interface), surface the state in the UI and hold last-known behavior. Never auto-substitute a default when a specific mode is selected.

4. **Audio/CV output safety stack (non-negotiable).** Anything that makes sound or sends voltage: defaults disabled, quiet defaults (−18 dB / 0V), soft-start ramps, hard limiter, isolated `AudioContext`, mic-feedback detection. `migrateSettings()` structurally forces `sonification.enabled = false`, `cvOutputEnabled = false`, and every CV channel disabled on **every** load, regardless of saved values. Reference implementations: `src/audio/Sonification.ts`, `src/audio/CVOutput.ts` + `cv-out-worklet.js`.

5. **Coexistence over replacement.** Classic ModMatrix and GraphEngine both exist (`Settings.modMode: classic | graph | both`). Pattern Generator is a compositing layer, not a fourth `sourceKind`. Presets / Timelines / Projects are three separate save formats with different scopes.

6. **Migrations are explicit.** Any saved-format change bumps the version (`_v` for Settings/presets — currently 28 in `src/state/Settings.ts`; `formatVersion` for projects) and adds an idempotent step to `migrateSettings()` / `migrateProject()`. Files with a newer version than the code log `console.warn` and normalize on save — never silently truncate.

7. **Documentation lands with the feature.** New modulatable Settings key → entry in `PARAM_DOCS`. New graph node → complete `NodeDef` in the registry (auto-appears in the About Node Catalog). User-facing behavior change → update `src/ui/help/content.ts` and the relevant `docs/about/*.md`. Docs are part of the feature, not a follow-up.

8. **Smallest working scope first.** Propose the minimum end-to-end version before maximalist scope.

## Architecture

### Entry and bundle strategy

`src/main.ts` routes between synth mode (default) and viewer mode (`?view=<peerId>` — fullscreen PeerJS stream viewer with no UI). Subsystems split into an always-on core (renderer, scene, panel, camera) and lazy modules loaded via dynamic `import()` (timeline, MIDI, audio FFT, OSC, recorder, broadcaster, help) to keep the initial gzipped bundle under ~400 KB. `src/io/IoSubsystems.ts` boots the I/O stack (MIDI clock/manager/mapping, FFT + beat detector, OSC client, CV in/out, gamepad) in its own chunk.

It's a **multi-page build**: `index.html` (synth) and `about.html` (long-form manual). The about page must ship zero synth runtime — no three.js, Web Audio, or PeerJS — enforced by `scripts/check-about-bundle.cjs`. Manual content lives as markdown in `docs/about/` and is rendered to HTML at build time by the `aboutMarkdown` Vite plugin (import suffix `?aboutMd`); `src/about/autogen.ts` builds the Param Reference and Node Catalog from `PARAM_DOCS` and the graph registry.

### Data flow (per frame)

```
video source (webcam/screen/file) ──┐
pattern layer (PatternRenderer) ────┴→ compositor → DCU shader (ruttEtra.vert/.frag)
                                                     ↑ uniforms read liveValues.get(key)
Settings (base values, flat keys) ──→ LiveValuesStore ←── ModMatrix.tick() (Classic slots)
                                          ↑            ←── GraphEngine.tick() (node graph)
        MIDI / OSC / FFT / beat / CV-in / gamepad / pattern-signal-bus feed both engines
```

- **`src/state/Settings.ts`** — typed store of every user-facing parameter, flat dot-free keys (usable as modulation/MIDI/OSC targets), subscribe/notify, versioned `migrateSettings()`.
- **`src/modulation/LiveValues.ts`** — computes `base + sum(offsets) * product(factors)` per namespace; contributions absent from a frame's `setContributions` call are cleared the same frame.
- **`src/modulation/ModMatrix.ts`** (Classic 4-slot engine) and **`src/modulation/graph/GraphEngine.ts`** (node-graph engine; ~40 node types under `graph/nodes/`, registry in `graph/registry.ts`, topo sort in `graph/topo.ts`). Shared output shaping in `modulation/outputStage.ts`.
- **`src/renderer/RuttEtra.ts`** — the scan-line mesh scene. `Postfx.ts` (feedback/bloom/CRT), `CameraRig.ts` (orbit + fly), `ResolutionManager.ts` (sole owner of renderer/postfx/pattern render-target sizing and canvas CSS). `XRManager.ts` (WebXR, v11), `AnaglyphRenderer.ts` and `record/StereoCompositor.ts` (stereoscopic, v12) — XR/anaglyph/stereo paths bypass the EffectComposer.
- **`src/renderer/patterns/`** — Pattern Generator layer: 16 fragment-shader patterns + oscilloscope mode, composited over the video source with 8 blend modes. Each pattern has a GLSL shader **and** a CPU mirror function in `PatternRegistry.ts` (intentional computation duplication — same param source) that publishes signals to `PatternSignalBus` for use as modulation sources.
- **`src/project/`** — Project (`.synth.json`) = full workspace (settings snapshot + presets + timelines); Preset (`.preset.json`) = a look; Timeline (`.timeline.json`) = a score. `Project.ts` is pure helpers; `ProjectStore.ts` handles dirty tracking / recent list / FS Access API with download fallback; `AutoSave.ts` + `RecoveredSession.ts` handle crash recovery. `applyProject()` always routes through `migrateSettings()` so the safety stack applies.
- **`src/ui/`** — vanilla-DOM control panel: `ControlPanel.ts` shell with Synth / I/O tabs, one file per panel section in `ui/sections/`, shared widgets in `ui/widgets.ts` / `ui/shared/SlotRow.ts`, responsive layout system in `ui/layout/`, timeline dock in `ui/timeline/`, graph editor (Beginner + Advanced views) in `ui/graph/`. CRT/phosphor theme in `panel.css` — see `docs/design/panel-design-system.md` for the row/grid layout contract before adding a new widget or row shape (it exists because a slider silently stopped filling its row once, from not having this written down). `ui/tooltip.ts` + `ui/help/sectionHints.ts` drive the panel's delayed hover tooltips (param rows from `PARAM_DOCS`, section headers from `SECTION_HINTS`).
- **`src/audio/`** — FFT analysis, beat detection, CV input/output (AudioWorklets in plain `.js`), Sonification (mesh → audio voice), MeshAnalyzer (8 stats from the `VideoTap` lo-res readback).
- **`src/stream/`** — PeerJS broadcaster/viewer and `WhipPublisher.ts` (WHIP → OBS/MediaMTX/Cloudflare).
- **`src/renderer/RenderPopout.ts`** — pops the render canvas into its own draggable window for two-screen performance rigs (companion to `src/ui/PanelPopout.ts`, which pops the *control panel* instead). Feeds the popup a `canvas.captureStream()` into a `<video>`, deliberately NOT `adoptNode`-ing the canvas itself — a live WebGL context does not reliably survive being moved to another window's browsing context, unlike the plain DOM `PanelPopout` moves.

### Backlog audit

`AUDIT.md` at the repo root is the Phase-0 audit (2026-07-05) of the feature/cleanup backlog: 29 items classified against the code with file:line evidence, a phased build order, and flags for anything touching the settings migration schema or the base/live split. Consult it before starting backlog work; update item statuses as phases land.

### State of the autonomous run (2026-07-05, branch `run/phases-1-4`)

All four phases of the AUDIT build order executed; every item landed as its own tested commit (suite 410 green, build clean at `64e039a`). Settings schema went **v16 → v25** (one migration per change; migration tests must assert `_v >= N`, never `=== N`). Timeline schema went v1 → v2. **The branch is NOT merged — merging to `main` triggers the FTP production deploy**, so review first.

**Shipped and done**: IPD fix (real bug: three's AnaglyphEffect eye separation was unsettable — vendored); burn-in fix (real bug: the feedback accumulator never compounded); README reconcile; vCenter/aspect docs; graph node/binding mute + My Patches library (v17); Classic slot slew via shared `slewToward` (v18); custom slider ranges with ±5×-span envelope (v19); two-screen popout (DOM adoption into `window.open`, drag handlers ownerDocument-proofed); panel param search (`/`) + tab cycling (`[`/`]`); multiplicative modulation for Classic (v20); LFO Lo/Mid/Hi range switch + continuous rotation knob (v21); MIDI clock out + emulated `Sync (V)` node (v22); ADSR envelope + resonant filter nodes; shape-masked feedback + analog character FX (v24); graph drag-to-wire / pan-zoom / per-port `nodeId#port` refs (v25).

**Awaiting owner decisions (prioritized review list)**:
1. **Dual raster** (`5bb53c8`, v23) — implemented behind `dualRasterEnabled`, default OFF. Flip Enable in the Dual Raster panel section and judge. Design + v1 shared-scope list: `docs/design/dual-raster.md`.
2. **Anti-menu-diving structural work** — search + hotkeys shipped; pinned performance strip (recommended) vs learn-from-the-knob vs command palette: `docs/design/anti-menu-diving.md`.
3. **Audio-rate modulation** — design doc only (`docs/design/audio-rate-modulation.md`); recommends shader scan-time oscillators; 3 open questions (bank size, intensity target, UI home).

**Keyframing v2 — full lane UI shipped (2026-07-11, v1.2.0)**: drawable per-parameter lane curves rendered in absolute values (not raw offsets — the curve reads in the same numbers as the panel knob, with a dashed line at the current base); 2D point drag with beat-snap; a resizable inspector column; per-param ◀ ▶ keyframe-jump arrows on panel rows; resizable timeline dock and side panel. **Auto-key semantics (superseding the original "on-keyframe vs. base-edit" split, fixed 2026-07-11 v1.3.0)**: once a param has a lane at all, the panel knob is ALWAYS keyed — on an existing point it rewrites that point, off one it auto-creates a new point at the playhead. The base is only ever touched by a knob for a param with NO lane. (The original design edited the base whenever the playhead was off a keyframe, which shifted the whole curve out from under every other keyframe — a real reported bug; `setKeyedValueAtPlayhead` in `keyframeAffordance.ts` is now the single source of truth for this.) Still open per `docs/design/keyframing-v2.md`: **record-knob-moves** (play + write live gestures into a lane) — not implemented, no owner decision yet.
5. Small follow-ups flagged in AUDIT.md: graph patch library not yet embedded in `.synth.json` Projects; dual-raster follow-ups (per-raster scan rates/sources/color); manual visual QA of the GPU-side changes (feedback shapes, analog FX, dual raster, rotation) — none have automated coverage since the suite deliberately excludes WebGL.

### State of the follow-up UX pass (2026-07-11, branch `timeline`, v1.2.0 → v1.3.0+)

A dense round of owner-reported bugs and small features, each landed as its own commit:

- **Timeline transport counter formats** (`sequencer/timecode.ts`) — Bars/Beats (the real clock) / Timecode / Frames / Samples, pure display conversions, DAW-convention `DISPLAY` dropdown next to the readout.
- **About page sidebar TOC** — replaced the old top-nav with a persistent, independently-scrolling left sidebar: 9 sections + every section's own h3/h4 sub-headings, built at runtime from the live DOM (zero manual TOC upkeep), scrollspy-highlighted, deep-linkable. Auto-generated Param Reference / Node Catalog sub-content deliberately excluded from the TOC (would bury real headings under ~60 param/node names) but stays searchable.
- **Auto-key fix** (see Keyframing v2 note above) — the actual reported bug: editing a slider off a keyframe was silently doing a global base edit.
- **`timelineDock` default flipped `'hidden'` → `'bottom'`** — visible on a fresh session (auto-save is OFF by default, so this DEFAULTS change is what most sessions actually see; an explicitly-saved `'hidden'` preference is still respected, never force-overridden).
- **Hover tooltips** (`ui/tooltip.ts`) — delayed (550ms) CRT-styled popover above param rows (from `PARAM_DOCS`) and section headers (from new `ui/help/sectionHints.ts`). Mouse only.
- **Panel layout bug class fixed** (`docs/design/panel-design-system.md`) — `.rw-slider`/`.rw-select` now carry `width: 100%` directly (not just relying on `.rw-row`'s CSS Grid to auto-stretch them), and a new `.rw-inline-group` utility class replaces every ad-hoc hand-rolled multi-child `.rw-row` div found in `SourceSection.ts` (Pattern Generator per-param rows) and `SonificationSection.ts` (4 rows) — CSS Grid auto-stretches a lone child; Flexbox does not stretch ANY child by default, which is what broke the Pattern Generator sliders when a "+" patch button sat beside them.
- **SCENES track fixed height** (`timeline.css` — `.rw-tl-track` `flex: 1 1 auto` → `flex: 0 0 48px`) — resizing the timeline dock taller used to inflate the scene keyframe markers into giant bars instead of revealing more lane rows; same fixed-track-height convention as Ableton/Logic/Pro Tools.
- **Render-canvas popout** (`renderer/RenderPopout.ts`) — companion to the existing panel popout; pops the OUTPUT into its own window via `captureStream()` (not `adoptNode`, see the architecture note above) with its own fullscreen toggle (auto-fades while fullscreen, `F` shortcut scoped to that window).
- **Fixed two long-standing doc-vs-code gaps found while touching fullscreen**: the `F` (fullscreen) and `H` (HUD toggle) global shortcuts were documented in the Shortcuts help since early on but were NEVER actually implemented anywhere in `src/`. Both now work (`main.ts`, near the `/`/`[`/`]` panel-hotkey listener). If you find another "documented but grep finds nothing" shortcut, it's worth a `git blame` before assuming it's yours to leave alone.

### Known drift

The README was reconciled to the v12+ state on 2026-07-05 (recent-changes section, structure tree, tech list). If README and source disagree, trust the source and fix the README in the same change.

## Debug helpers

- `?debug=mod` — overlay showing base/live/Δ per modulated param (`ModDebugOverlay.ts`).
- `?view=<peerId>` — viewer mode.
