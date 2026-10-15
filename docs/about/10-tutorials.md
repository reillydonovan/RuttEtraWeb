## Tutorials

Hands-on lessons, each a few minutes long. Screenshots land here as the
collection grows — for now, every step names the exact control so you
can follow along in the app.

<!-- video-course:start -->

### Video course

Short narrated lessons, each building on the one before, on the
[Video Tutorials page](./tutorials.html) (also **Help ▸ Video Tutorials** in the app).

#### Beginner

**Getting started**

1. [First look](./tutorials.html#first-look) — Pick a source, orbit the camera, turn up Z Push, and make your first patch.
2. [Windows, tabs and layouts](./tutorials.html#workspace) — Switch tabs, maximize a window, try layout presets, and change the panel skin.
3. [Sources](./tutorials.html#sources) — Pattern Generator kinds, and loading a video file as the picture.

**The Controls panel**

4. [Finding your way around](./tutorials.html#controls-tour) — Tabs, sections, search, knobs, ranges, and the ⓘ help.
5. [Shaping the raster](./tutorials.html#shaping) — Size, depth, rotation and luminance — the scan processor itself.
6. [Color, glow and presets](./tutorials.html#look) — Bloom, feedback, the virtual camera, and one-click presets.
7. [Modulation](./tutorials.html#modulation) — A Classic modulation slot: a sine wave moving a parameter.

**The Timeline**

8. [Keyframes](./tutorials.html#timeline-keyframes) — Create a timeline, key a parameter at two bars, and play it back.
9. [Scenes](./tutorials.html#timeline-scenes) — Snapshot whole looks as scenes and let the timeline move between them.

**The Patch Bay**

10. [Cables](./tutorials.html#patchbay-cables) — Waveforms into a function generator, its output into a parameter; move and unplug.
11. [Nodes and the Scope](./tutorials.html#patchbay-nodes) — Add nodes with a right-click, watch signals on a Scope, delete what you do not need.
12. [Video routing](./tutorials.html#patchbay-video) — Composite a video file with the Pattern Generator and feed the renderer.

#### Intermediate

**The Graph engine**

13. [Graph mode and the Library](./tutorials.html#graph-beginner) — Beginner view rows, Noise and Ramp sources, ready-made patches, and Both mode.
14. [The Advanced canvas](./tutorials.html#graph-advanced) — Add nodes, wire them, edit them in the inspector, bind to the synth, and probe a signal.

**Video and sound**

15. [Dual Raster](./tutorials.html#dual-raster) — A second raster with its own geometry, wipe and interleave modes, and its own picture from the Patch Bay.
16. [Audio-reactive](./tutorials.html#audio-reactive) — The Audio section, beat detector, spectrum displacement, and an audio-reactive graph patch.
17. [The Oscilloscope](./tutorials.html#oscilloscope) — Draw any signal as a trace and let the raster turn it into terrain.

**Looks and output**

18. [Render modes and Post FX](./tutorials.html#looks-deep) — Wireframe and dot rasters, custom tint, shaped feedback, analog character, chroma, scanlines.
19. [Save, record, share](./tutorials.html#save-share) — User presets, project files, recording a clip, and live sharing with a link and QR code.

#### Advanced

**Deep patching**

20. [Clocks, sequencers, envelopes](./tutorials.html#clocks-sequencer) — A tempo clock driving a step sequencer, a divided clock firing an ADSR envelope, probed live.
21. [Feedback and chaos](./tutorials.html#feedback-chaos) — Resonant filtered noise, Param Out, a frame delay, and a patch that feeds on itself.
22. [The camera as a source](./tutorials.html#video-modulation) — Video Luma with a picked region, Video Motion through a Slew, and the motion-glitch patch.

**I/O**

23. [MIDI and OSC](./tutorials.html#io-midi-osc) — Connect a controller, learn a mapping, MIDI clock in and out, and OSC over the network.
24. [CV, gamepads and MCP](./tutorials.html#io-cv-mcp) — Control voltage inputs, OSC CV, gamepads, and an AI assistant driving the synth over MCP.
25. [Outputs](./tutorials.html#io-outputs) — Sonification and the Sonify node, CV Out to a modular, MIDI clock out, and the safety stack.

**Performance**

26. [Stereo and 3D](./tutorials.html#stereo-3d) — Red-cyan anaglyph, side-by-side stereo recording, and WebXR headsets.
27. [A performance rig](./tutorials.html#performance-rig) — Layouts, HUD, shortcuts, performance profiles, output resolution, fly mode, timecode and popouts.
28. [Showcase: getting weird](./tutorials.html#showcase) — Five strange setups: a feedback tunnel, interleaved worlds, resonant chaos, sound terrain, anaglyph Lissajous.

<!-- video-course:end -->

### The interactive walkthrough (Help ▸ Start Tutorial)

The written lessons below are one way in. There's also a guided,
in-app version: **Help ▸ Start Tutorial** dims the interface, spotlights
the control being discussed, and floats a callout with Back / Next /
Exit — 8 steps from picking a source through Z Push, the camera,
modulation, a one-click sample patch, and saving your look. It's opt-in
only; nothing runs it automatically, and the highlighted control stays
fully interactive the whole time (the dim is visual, not a click-guard),
so a step that says "try dragging this" means you actually can, live,
without dismissing anything first. Press Esc or **Exit** anytime.
Re-runnable as many times as you like.

### Tutorial 1 — Make the image breathe with your microphone

Goal: your mic's loudness drives **Z Push** (the depth of the scanline
mesh), so the image physically pulses with sound. Two ways to wire it —
the Patch Bay way (visual, recommended for learning) and the Controls
way (fast once you know the instrument). Both edit the SAME thing: a
Classic modulation slot. The cables in the bay and the dropdowns in the
Modulation panel are two views of one patch — watch them mirror each
other as you go.

**Setup (once)**

1. Load the synth and pick any source on the boot screen — or click
   *continue without video* and enable the Pattern Generator
   (Video Source A → Pattern Generator → Enable) so there's an image to modulate.
2. Turn the mic on: open **CONTROLS → Synth tab → Modulation**, and under
   *Audio Interface (mic)* click **Enable Mic**. Grant the browser
   permission. (Audio analysis is opt-in per session, on purpose —
   the synth never listens by default.)

**The Patch Bay way**

3. Open the bay: **Window ▸ Layout ▸ Patch Bay** (or pick PATCH BAY in
   any window's tab strip / + menu).
4. Find the **SOURCES** bus along the top. Drag the **AUDIO ENV** jack
   down onto **FUNCTION GEN 1's SRC IN** jack. A cable connects — GEN 1's
   little LCD now reads AUDIO, and it switched itself on (plugging a
   cable enables the generator; that's what the gesture means).
5. Drag **GEN 1's OUT** jack onto the **Z Push** jack (DEPTH field, in
   the DCU column). Second cable. The patch is live.
6. Make some noise. The mesh should pump. Too subtle or too wild? GEN 1's
   **AMT** field is the modulation depth — try 0.5 to 2.
7. Open **CONTROLS → Modulation** and look at slot 1: Source = `Audio
   level (mic)`, Target = `Z Push`, exactly what you patched. Change
   either side there and the bay's cables follow. Same patch, two views.

**The Controls way (the same thing, no cables)**

3. **CONTROLS → Synth → Modulation**, slot 1: set **Source** to `Audio
   level (mic)`, **Target** to `Z Push`, **Amount** to `0.8`, and flip
   the slot's enable toggle.

**Why your slider didn't move** — by design. The Z Push slider still
shows the value *you* set; the audio wobble rides on top of it (the
base/live split — see Design Principles). Turn the generator off and
Z Push lands exactly where you left it.

**Where to go from here**

- Any input works the same way: the SOURCES bus also carries **MIDI CC**,
  **CV IN**, and **OSC** jacks. Plug one into a generator's SRC IN, then
  set the specifics (which CC number, which CV channel) in that slot's
  expanded body in the Modulation panel. The I/O tab holds the device
  side (MIDI device, DC-coupled interface, OSC bridge).
- Any parameter works the same way: every labeled jack on the bay — all
  ~90 of them, Camera FOV to Pattern Frequency to CV OUT channels — is a
  valid Target, and the same list backs every Target dropdown.
- Four generators run at once (they're the Classic matrix). For patches
  bigger than four routes — or math between signals — switch the
  Modulation section to **Graph** mode: an unlimited node graph
  (LFOs, audio bands, MIDI, CV, logic, envelopes) with its own editor,
  whose bindings show up in the bay as cyan cables.
