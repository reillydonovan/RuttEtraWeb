# Backlog Audit — 2026-07-05

Phase 0 audit of the design-session backlog against the codebase as of `5d6cc41` (v12-era, Settings `_v: 16`). Each item is classified with file:line evidence.

## Resolved decisions (2026-07-05, post-audit review)

1. **Automation writes through LiveValues.** Keyframe lanes are a third offset-writer alongside the two modulation engines — lane values sum with base exactly like CV into an input sums with the knob on the original hardware. Keyframes are therefore relative offsets *by architecture*; the Keyframing v2 design must spec the timeline UI to preview the resolved absolute value (display decision, not architecture).
2. **Zoom-to-zero = DCU deflection path.** `hSize`/`vSize` floors go to zero — the faithful collapse-the-scan gesture. Not a camera move.
3. **Faithful vs Rutt+: labeled grouping, no hard mode.** Faithful controls stay console-adjacent, Rutt+ sections get a badge, lineage documented on the About page.

Execution status is tracked per item below (✅ with commit hash as items land).

**Legend**: ✅ implemented · 🟡 partial · ❌ absent · ⚠️ conflicts with current architecture
**Lineage**: `[Faithful]` = emulates the original Rutt/Etra hardware (or the user's hardware reference) · `[Rutt+]` = extension beyond the original.

---

## Modulation / LFO

### 1. LFO frequency to 20,000 Hz (audio-rate) — ❌ absent, ⚠️ architecture conflict `[Faithful]`
- Classic slot LFO caps at **20 Hz** (`src/ui/sections/ModulationSection.ts:506`, min 0.001); Graph `lfo` node caps at **30 Hz** (`src/modulation/graph/nodes/sources.ts:29`).
- ⚠️ **Why it conflicts**: all modulation is computed once per render frame (`matrix.tick(dt)` at `src/main.ts:988`, `graphEngine?.tick(dt)` at `main.ts:1002`), so the effective Nyquist is ~30 Hz at 60 fps. Raising the slider cap alone would just alias. True audio-rate modulation needs a different substrate: an AudioWorklet-rate oscillator whose output is consumed per-frame (like CV input already does), or oscillation evaluated inside the DCU shader (like the pattern shaders do). This is a design decision, not a slider tweak.

### 2. LFO smooth-vs-stepped output option — 🟡 partial `[Faithful]`
- Graph mode has a real **Slew** node (rise/fall 0–5000 ms, `src/modulation/graph/nodes/processors.ts:282-308`) — insertable anywhere.
- Classic slots have **no** output smoothing; the output-stage `'step'` curve is a hard 3-level quantizer (more stepped, not less — `src/modulation/outputStage.ts:98-102`). Source-specific smoothing exists only for audio (attack/release) and joystick (1-pole LP) (`ModMatrix.ts:575-615`).
- **Missing**: a per-slot slew/glide control in Classic. Touches `ModSlot` schema → migration.

### 3. Sync system (internal + sync out / external in; H/V sync lock) — 🟡 partial `[Faithful]`
- ✅ Internal: `Settings.internalBpm` (canonical, shared by LFOs / Timeline / Graph clock).
- ✅ External sync IN: full 24-PPQ MIDI clock receiver (`src/midi/MidiClock.ts`), honored by Classic slots, Graph clock node, Timeline.
- ✅ Sync OUT to hardware: CV output `'clock'` type — BPM-divided square wave with division/pulse-width/amplitude (`src/audio/CVOutput.ts:511-519`, `Settings.ts:392-437`).
- ❌ MIDI clock OUT: `MidiManager` sends CC only; no `0xF8`/start/stop transmission anywhere.
- ❌ Lock to horizontal/vertical video sync: no such concept exists. ⚠️ Note: there is no real H/V sync in a WebGL renderer — this would be a *simulated* sync source (e.g. a clock derived from `scanRate` × frame rate), which is a legitimate faithful-emulation feature but needs framing as such.

### 4. Low / Medium / High range switch on oscillators — ❌ absent `[Faithful]`
- No coarse range/octave multiplier switch on any LFO or oscillator. Only `range` hits are the graph Remap processor and CV voltage ranges. Cheap to add (a ×0.01 / ×1 / ×100-style multiplier on slot + lfo-node rate); pairs naturally with items 1 and 7.

### 5. Multipliers ×4 — 🟡 partial `[Faithful]`
- Graph mode already has ~5 multiplicative facilities: `multiplier` (ring-mod A×B), `scale`, `attenuator`, `mixer` (4-in), `crossfade` (`processors.ts:13-158`).
- **Dormant infrastructure**: `LiveValuesStore` supports multiplicative factors — `live = (base + Σoffsets) · Πfactors` (`src/modulation/LiveValues.ts:52,149-157`) — **but neither engine writes factors today**; ModMatrix passes empty factors (`ModMatrix.ts:319-320`). Param modulation is currently additive-only. Activating add/multiply mode per slot/binding is the designed-but-unused path. ⚠️ Touches the base/live split (by design — this is what the factor path is *for*).

### 6. Modular signal stacking (osc → filter → EG chains; sound↔image) — ✅ largely implemented, 🟡 catalog gaps `[Rutt+ core]`
- GraphEngine does arbitrary topo-sorted output→input chaining across ~48 node types: 6 sources, 17 processors, 4 logic, 6 video, 11 inputs, 4 audio (`src/modulation/graph/`). Audio→image (audio-envelope/band/pitch/onset) and image→signal (video-luma/motion/edge/color, pattern-output) both work.
- **Gaps**: ❌ no true ADSR **envelope generator** node (closest: one-shot `ramp` with trigger; `audio-envelope` is a follower); ❌ no **filter** node (no lowpass/biquad/resonance — `slew` is the only smoother); ❌ no audio-output sink from the graph (sonification is a separate one-way subsystem; the graph's only outward sink is `cv-output`).

### 7. Subsonic voltages — ✅ implemented
- Classic LFO floor is **0.001 Hz** (1000 s period, `ModulationSection.ts:506`); ramps to 600 s. Minor polish: Graph lfo floor is 0.01 Hz — could align to 0.001.

## Second raster / dual trace

### 8. Second independently-modulated raster — ❌ absent `[Faithful — hardware reference]`
- The scan mesh is a strict singleton: `private mesh: THREE.LineSegments | null` (`src/renderer/RuttEtra.ts:35`), one video→compositor→DCU pipeline, one material. No second raster anywhere.
- ⚠️ **Biggest architectural item in the backlog.** A raster B needs: a duplicated (or parameterized) DCU param namespace, every B param registered as a ModTarget, live-value reads per raster, migration for all new keys, and UI. Interacts with XR/anaglyph/stereo paths (which render "the scene" — two meshes would come along for free there, which is good).

### 9. Dual-trace wipe slider (A over B, split point sweepable) — ❌ absent (depends on 8)
- No wipe/split facility. The pattern compositor's `mask` blend mode is unrelated (pattern-over-video keying, not raster A/B split).

### 10. Alternate-line interleave mode — ❌ absent (depends on 8)
- DCU `skip` drops rows pseudo-randomly (`ruttEtra.vert.glsl:136-141`) but there's no second raster to interleave. Natural implementation: parity-based row assignment in the vertex shader once raster B exists.

### 11. Voltage control of the dual-trace slider — ❌ absent (depends on 8)
- Trivial once 8–9 exist: make the wipe position a Settings key + `TARGETS` entry and it is automatically CV/MIDI/OSC/graph-modulatable (same pattern as every other param).

## Controls / fidelity

### 12. 90° rotation — knob + switch, sin/cos — 🟡 partial `[Faithful]`
- ✅ `rotate90` binary toggle, end-to-end (UI `DcuSection.ts:51`, shader `ruttEtra.vert.glsl:113-115`, docs `paramDocs.ts:90`).
- ❌ Continuous in-plane rotation knob: `hSpin`/`vSpin` are 3D-axis spins (with sin/cos, `ruttEtra.vert.glsl:121-125`), not total image rotation. Missing piece: a `rotation` angle param (0–360°, modulatable) composed with the `rotate90` switch.

### 13. Vertical center voltage-control input — ✅ implemented (minor docs debt) `[Faithful — hardware reference]`
- `vCenter` exists (`Settings.ts:162,667`, UI `DcuSection.ts:44`) **and** is a routing target (`src/ui/targets.ts:27`) → already drivable by CV in via Classic slot or Graph. `vPos` likewise.
- 🟡 Docs gap: `vCenter`/`hCenter` have **no `PARAM_DOCS` entry** — violates docs-land-with-feature; fix in housekeeping.

### 14. Zoom to zero — ❌ absent `[Faithful]`
- Camera: FOV slider floor **10°** (`CameraSection.ts:41`), dolly floor `minDistance = 0.05` (`CameraRig.ts:101-102`). No mesh-scale param. Nothing reaches zero.
- Open design question for the build phase: "zoom to zero" as *image size* may be servable via DCU `hSize`/`vSize` floors instead of camera — verify their minimums and decide which control should collapse to zero.

### 15. LCS-style voltage rescaling (1V→5V etc.) — ✅ implemented
- CV out: per-channel `scale` (−20..20), `offset` (−20..20 V), `voltageRange` (±5/0-5/±10/0-10) (`CVOutput.ts:479-490`, UI `CVOutputSection.ts:388-392`); 1V/oct pitch with calibration incl. Buchla 1.2V/oct.
- CV in: per-channel range/polarity/invert/calibration-offset (`CVInput.ts:85-97,336-347`). OSC: per-binding min/max+curve. Graph: `range` (remap in→out), `scale`, `offset` nodes — the canonical rescale-anywhere path.
- 🟡 Only nit: CV *input* UI has no free gain multiplier (range/polarity/invert only); graph nodes cover it downstream.

### 16. Type custom values; custom min/max ranges — 🟡 split verdict
- ✅ Typing: every slider has an inline `<input type="number">` (`src/ui/widgets.ts:88-99,236-239`), a tap/long-press numeric modal (`widgets.ts:314-353`), and keyboard step/fine-adjust (arrows, PgUp/Dn, Home/End).
- ❌ Custom ranges: slider min/max are hardcoded call-site arguments (`widgets.ts:79-85`); no UI overrides a param's range anywhere. Per-binding min/max (MIDI/OSC) scales binding output, not the param's own range. ⚠️ If custom ranges are persisted per-param, that's a new Settings structure → migration; also must interact carefully with modulation clamping (base clamps vs live clamps).

### 17. Buchla/banana/Eurorack patching surface — 🟡 partial, closer than expected `[Rutt+]`
- `AdvancedView.ts` + `CableLayer.ts` already deliver: port jacks with kind-colored dots, bezier cables color-coded by signal kind with glow and animated dash-flow, draggable nodes, palette, inspector, probe scope.
- Missing modular-desk feel: ❌ drag-from-jack wiring (currently click-click, no rubber-band cable), ❌ canvas pan/zoom (`AdvancedView.ts:8-11` notes it), ❌ per-output-port connection fidelity (`CableLayer` assumes `outputs[0]`; `node.inputs[port]` stores node id only, not source port — fixing this is a **patch schema change** → migration).

## Effects / feedback

### 18. Classic video feedback — ✅ implemented `[Faithful]`
- Feedback pass before bloom: `max(current, previous*decay)` into a persistent RT (`src/renderer/Postfx.ts:74-84,238-256`). `feedbackEnabled` + `feedbackDecay` (0.5–0.999, modulatable — `targets.ts:35`). UI group "Burn-In Feedback" (`ColorPostFxSection.ts:56-61`).

### 19. Feedback within a movable shape — ❌ absent `[Rutt+]`
- No mask/shape/position facility in the feedback pass. Would add a mask term (shape kind, center x/y, radius, softness) to `FEEDBACK_FRAG` — all four naturally modulatable params (movable circle = LFO on center).

### 20. Analog-degradation effects (Izotope Vinyl reference) — ❌ absent `[Rutt+]`
- Post-FX inventory is bloom, scanline overlay, chromatic aberration (clean RGB split), vignette, feedback. No grain, scratches, hum bars, dropout, wear, or chroma bleed.

### 21. "Burn in didn't do shit" — 🟡 explained; naming/UX bug, not a missing subsystem
- "Burn-In" is just the **UI label for the feedback pass** (item 18): the group title (`ColorPostFxSection.ts:56`), the paramDoc ("CRT burn-in"), and a preset (`presets.ts:100-113`, decay 0.94). There is no separate burn-in effect.
- Likely why it "didn't do shit": `feedbackEnabled` defaults **false**; the `max()` blend only leaves trails where bright content *moves* — on static or dark scenes it's invisible; and decay 0.9 fades in ~1s. Options for the build phase: make the effect legible (additive/persist blend option, longer decay range, default demo preset), and/or rename so "burn-in" isn't promising phosphor memory it doesn't deliver.

### 22. Noise "will get ramified" — 🟡 partial
- Noise exists only as **input-signal generators**: white/perlin/worley pattern shaders (`src/renderer/patterns/shaders/`), composited pre-DCU. There is no post-FX noise/grain layer and no noise injection into modulation targets beyond the graph `noise` source node. Ramification path: pairs with item 20 as one "analog character" post-FX pass.

## Graphs / sequencing / keyframing

### 23. Graphs removable / individually enable-disable-able — 🟡 partial, with a capability asymmetry
- ✅ Node delete (right-click/Backspace, cascades edges+bindings — `AdvancedView.ts:281-290`); ✅ whole-engine disable via `modMode` (`GraphEngine.ts:148-156`); ✅ Classic slots have a per-slot `enabled` toggle (`Settings.ts:85`, `ModMatrix.ts:269-273`).
- ❌ No per-node or per-binding `enabled`/bypass flag in the graph (`types.ts:46-55,57-85`) — only destructive delete or `amount=0`. ❌ No user patch **library**: 7 hard-coded read-only starter templates, one active patch (`library.ts:19-126`); you cannot save/delete named patches.
- ⚠️ Both fixes touch the serialized `GraphPatch` (lives inside Settings) → `_v` bump + migration backfill (`enabled: true` default).

### 24. Sequencers — ✅ implemented (two distinct things; know which is which)
- `src/sequencer/` is a **preset-snapshot keyframe timeline**: keyframes hold whole-Settings snapshots at bar positions, interpolated (numbers lerp, colors channel-lerp, enums step at t≥0.5) with 6 easing presets, loop, undo/redo, excluded-params list, `internal|midi` sync reading `Settings.internalBpm` (single-source BPM, no silent fallback — `Sequencer.ts:365-368`).
- Separately, a graph **`sequencer` node** — a true 8-step CV sequencer (`graph/types.ts:41`) used by the "Beat-Synced Step Sequencer" starter patch.

### 25. Keyframing needs work — 🟡 confirmed; gap list
Current UI (`src/ui/timeline/`) is functional: add (dbl-click/Ctrl-click/K/drag-preset-card), drag-move with beat snap (Alt=free), delete/duplicate/lock/replace-with-current/preview, per-keyframe inspector (name/bar/easing/color), zoom 20–240 px/bar, scroll, click-to-seek, timeline save/rename/delete/export/import.
Gaps, in rough severity order:
1. **No per-parameter automation lanes** — automation is whole-snapshot only; you cannot animate one knob independently. The structural gap.
2. **No recording of live knob moves** ("Record Timeline" records *video*, not automation — `RecordSection.ts:202-268`).
3. No curve/handle editing between keyframes (6 fixed easings only).
4. No copy/paste, no multi-select/marquee/group-move (single `selectedKeyframeId`).
5. Snapping is beat-only, non-configurable.
6. `autoPersist = false` (`store.ts:27-30`) — timelines silently vanish on refresh unless saved into a Project. UX foot-gun.
7. `TimelineDock.resize()` is a documented placeholder.
- ⚠️ Lanes are a Timeline schema change (`_v` bump in `sequencer/types.ts`) and must write through `LiveValuesStore` if lanes are to coexist with modulation (lane = another contribution source), or through Settings if lanes replace the base — a base/live design decision to make explicitly before building.

## UI / UX

### 26. Reduce menu-diving — 🟡 shallow but zero fast-nav
- IA is a 3-tab shell (Synth/I-O/Help) with collapsible accordion sections. Depth measured: DCU param **0–1 clicks** (open by default); modulation slot target **~3**; CV out channel setting **~3–4** (includes "+ Add output" on first use).
- Missing entirely: param search / command palette, favorites/pinning, keyboard section jumps, and learn-from-the-knob (MIDI/OSC/CV learn is initiated from the I/O sections, not by right-clicking a slider). Those four are the highest-leverage anti-menu-diving features.

### 27. Two-screen support (controls on one display, output on another) — 🟡 approximation only
- ❌ No `window.open` popout, Document Picture-in-Picture, Presentation API, or `BroadcastChannel` anywhere in `src`.
- 🟡 Works today: `?view=<peerId>` viewer mode — second window/device shows output fullscreen over WebRTC (`main.ts:1167-1207`) — but requires starting a broadcast, adds WebRTC latency/compression, and is one-way. A same-machine popout (Document PiP for the canvas, or a BroadcastChannel-synced control window) does not exist and would be the proper fix.

## Bugs

### 28. IPD doesn't work with the slider — ✅ root-caused (anaglyph slider is dead at the three.js layer)
- Two IPD sliders exist. **Recording** stereo (`stereoIpdCm`, `RecordSection.ts:289` → `StereoCompositor.computeWorldIpd`, `StereoCompositor.ts:211-221`) is wired correctly and works. There is no IPD control in XR at all.
- **Anaglyph** ("Eye Sep (cm)", `anaglyphIpdCm`, `CameraSection.ts:125`): the slider→Settings→subscriber wiring is correct (`main.ts:429`), but `AnaglyphRenderer.setIpd` writes `this.effect.eyeSep` (`AnaglyphRenderer.ts:88-90`) — and in three r0.169, `AnaglyphEffect` keeps its `StereoCamera` **private inside the constructor closure** and never reads an `eyeSep` property. The assignment sets a dead property; on-screen depth never changes. (The code's own comment at `AnaglyphRenderer.ts:36-39` admits it's trusting an undeclared runtime property.)
- **Verify before fixing** (node_modules wasn't installed at audit time): confirm `node_modules/three/examples/jsm/effects/AnaglyphEffect.js` has no `eyeSep`. Fix direction: drive a `StereoCamera` directly (or vendor/extend the effect).
- Secondary: StereoCompositor scales IPD by mesh width; anaglyph does a raw cm→m divide — after the fix, reconcile so the two stereo surfaces produce comparable depth.

## Housekeeping

### 29. README reconcile — ❌ confirmed stale
- README "Recent changes" stops at v10; code is at v12 (XR, anaglyph, StereoCompositor, WHIP, hls.js, sample video). Structure tree omits `src/sequencer/`, `src/project/`, `src/perf/`, `src/platform/`, `src/ui/layout/`, `src/ui/timeline/`. Settings at `_v: 16`. (Drift already noted in CLAUDE.md.)

---

# Proposed build order

Each phase gates on review. **⚙️ = touches `migrateSettings()` / versioned schema. 🔀 = touches the base/live split.**

## Phase 1 — Housekeeping
1. **README reconcile** (item 29) — no code risk.
2. **IPD fix** (item 28) — verify AnaglyphEffect internals, drive StereoCamera properly, reconcile anaglyph vs recording depth scaling. Bug fix, no schema.
3. **Docs debt**: `PARAM_DOCS` entries for `vCenter`/`hCenter` (item 13 remainder).
4. **Burn-in legibility** (item 21) — rename or make the feedback trail obviously visible (blend option ⚙️ if a new key; decay range widening is key-free).
5. **Graph LFO floor** 0.01 → 0.001 Hz (item 7 polish) — range change only.

## Phase 2 — UI/UX cleanup
6. **Per-node / per-binding enable + user patch library** (item 23) ⚙️ (GraphPatch schema, `_v` bump, backfill `enabled: true`).
7. **Anti-menu-diving kit** (item 26): param search / command palette, learn-from-the-knob context action, section hotkeys, favorites. No schema unless favorites persist ⚙️.
8. **Two-screen popout** (item 27): Document PiP for the canvas (Chromium) with `?view=` as the cross-machine/fallback path.
9. **Custom min/max ranges** (item 16b) ⚙️🔀 — persist per-param overrides; decide clamping semantics (base clamps in widgets; live clamps unchanged).
10. **Classic slot slew** (item 2) ⚙️ (`ModSlot` fields) — brings Classic to parity with the graph Slew node.

## Phase 3 — Features (faithful tier first)
11. **Multiplicative modulation** (item 5) 🔀⚙️ — activate the dormant LiveValues factor path; add add/multiply mode per slot/binding. Small code, big expressive win, and it exercises the designed architecture.
12. **Range switch Lo/Med/Hi** (item 4) ⚙️ + **rotation knob** (item 12) ⚙️ + **zoom-to-zero** (item 14, resolve camera-vs-hSize question) — small faithful controls batch.
13. **Sync out** (item 3): MIDI clock transmit; simulated H/V-sync clock source (framed as emulation) ⚙️.
14. **Graph catalog completion** (item 6): ADSR envelope node + filter node ⚙️ (node registry + docs auto-land).
15. **Audio-rate modulation** (item 1) ⚠️🔀 — needs an architecture decision first (worklet-rate oscillator bank vs shader-side oscillation). Propose a design doc before code.

## Phase 4 — Features (large)
16. **Dual raster suite** (items 8→9→10→11 in that order) ⚙️🔀 — the flagship. Raster B param namespace, wipe compositor, interleave mode, modulatable wipe position. Stage per item 9-first? No: 8 (second mesh + params) → 9 (wipe) → 10 (interleave) → 11 (free once wipe position is a Settings key + TARGETS entry).
17. **Feedback-in-shape** (item 19) ⚙️ + **analog-character post-FX pass** (items 20+22: grain/scratches/hum/wear) ⚙️ — one post-FX workstream.
18. **Keyframing v2** (item 25) ⚙️🔀 — per-param automation lanes + knob-move recording. Requires the explicit base/live decision (lanes as a LiveValues contribution namespace vs Settings writes); then copy/paste, multi-select, curve handles, autoPersist default.
19. **Patching surface polish** (item 17) ⚙️ (per-port connection schema) — drag-to-wire, rubber-band cable, pan/zoom.

## Faithful vs Rutt+ organization
Faithful items: 1, 2, 3, 4, 5, 8–14, 18, 21, 22. Rutt+ items: 6 (done), 15 (done), 17, 19, 20, plus most of Phase 2 UX.
Recommendation per principles 5 & 7 (coexistence; user mental model): **not a hard UI mode** — instead label panel groupings, e.g. DCU-adjacent faithful controls stay in the DCU/console sections, Rutt+ facilities (graph patching, pattern layer, analog-character FX) keep their own sections with a subtle "Rutt+" badge, and the About page's design-principles section documents the lineage split. A hard mode switch would hide working features and add a second state axis to every save format. Revisit only if the panel gets crowded enough that a "console view" filter earns its keep.
