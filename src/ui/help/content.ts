/**
 * Help/manual content. Each tab is a markdown string (or function returning
 * one for dynamically generated content).
 *
 * Voice: short sentences, concrete examples, no jargon without parenthetical.
 */

import { DEFAULTS, Settings } from '../../state/Settings';
import '../../modulation/graph/bootstrap';
import { allDefs } from '../../modulation/graph/registry';
import { PARAM_DOCS, ParamDoc, PanelGroup } from './paramDocs';

// Re-exported for in-app help consumers (HelpSection.ts) so existing
// imports from `content.ts` keep working unchanged. The actual map and
// types live in `paramDocs.ts` so the about page can pull just those
// without dragging in the heavy in-app help markdown blobs below.
export { PARAM_DOCS, type ParamDoc, type PanelGroup };

export interface HelpTab {
  id: string;
  label: string;
  markdown: string | (() => string);
}

// =====================================================================
// Per-parameter docs are now in `./paramDocs.ts` (pure-data module so
// the about page can import them without the in-app help markdown).
// Re-exported above for backward compatibility.
// =====================================================================

// =====================================================================
// Tab content
// =====================================================================

const MD_WHAT = `
# What is Rutt/Etra Web?

A live video synthesizer in your browser. It takes any video signal (webcam,
screen share, or a local file) and re-draws it as a 3-D landscape of glowing
scan lines — exactly the way the **Rutt/Etra Scan Processor** did in 1974, but
in WebGL.

Bright pixels are pushed *toward* the camera, dark pixels stay flat. You get a
shimmering relief map of the moving image you can fly around with the mouse.

This build adds CRT post-processing, audio reactivity, MIDI/OSC control, and a
keyframe-based timeline so the whole thing can perform itself.
`;

const MD_QUICKSTART = `
# Quick start

> Desktop has a traditional **menu bar** along the top: **File** (project
> New/Open/Save + backup), **Edit** (timeline undo/redo), **View** (skins,
> **Theme**, HUD, fullscreen, docking, **Text Size**), **Window** (pop-out controls/output,
> workspace regions, layout presets), and **Help** (this manual and more).
> Everything in it is also reachable the old ways — same actions, one
> implementation.
>
> The interface is four **windows** (left / center / right / bottom),
> each holding **tabs** like Unity or Blender: click to switch, drag a
> tab onto another window's strip to move it (empty windows appear as
> drop strips while you drag), or use a window's **[+]** to pull any
> view in (RENDERER / CONTROLS /
> TIMELINE / PATCH BAY). Moving a view never disturbs another window —
> its old home just shows its own next tab. ⤢ maximizes, – collapses.
> **Window ▸ Layout**: Default (4-up), Classic, Tall, Wide,
> Performance, Patch Bay — and **Reset Layout** to retreat to stock.
>
> New to patching? The About page's **Tutorials** section walks through
> wiring your microphone to Z Push in about two minutes — the same
> patch in cables (Patch Bay) and dropdowns (Modulation panel). Or try
> **Help ▸ Start Tutorial** for a guided, in-app walkthrough that
> spotlights each control as you go (opt-in — never runs on its own).
> **Help ▸ Video Tutorials** opens a short narrated video course:
> getting started, the Controls panel, the Timeline, and the Patch Bay.
>
> The **PATCH BAY** view is the instrument as a hardware faceplate and a
> node editor: scroll to zoom, grab the board anywhere the cursor
> shows an open hand (empty space or a module's non-control parts) to pan, drag
> a module's header to reorder or break it into free layout. Drag a
> cable or module to the edge of the view and the board glides along
> so you can reach a jack that's off-screen. The four
> Classic slots become FUNCTION GENERATOR modules with SRC IN and OUT
> jacks, VIDEO SOURCE A/B modules switch webcam/screen/file feeds (A
> mirrors Controls ▸ Video Source A; B is independent), each with an OUT jack —
> drag both onto a COMPOSITE module's two inputs (Add/Subtract/
> Multiply/Screen/Difference/Mask/Crossfade/B-only + mix) and its OUT
> onto RENDERER's IN to blend two sources into the mesh's video input.
> A **DUAL RASTER** module instead gives raster A and raster B two
> genuinely independent feeds (drag Source A/B or Composite's OUT onto
> its two inputs, its OUT onto RENDERER IN — wiring it also switches
> Dual Raster on). RENDERER IN shows no cable while unplugged — it
> silently normals to Source A, exactly the pre-existing single-source
> behavior. And every parameter is a labeled jack in
> the original console's engraved groups with a **rotary knob** and an
> editable value field under it (drag vertically, Shift = fine) — run
> the whole synth from the bay without Controls open. While modulation
> drives a param, an **amber needle** rides the knob and an amber
> ▸ readout shows the live value. Like the real hardware, every param
> row has an **OUT jack** too: drag it onto another param to feed that
> param's live value there (a Param Out node appears, one frame
> behind, like a feedback loop). Dragging cables IS editing the patch —
> the Modulation panel updates as you go. A GRAPH ENGINE section shows
> one module per graph node (every node, dimmed if unconnected), with
> knobs/dropdowns for its params, a mute LED, and IN jacks for ports
> like Ramp's trigger; waveform pickers (LFO shape) take a SOURCES bus
> jack — drag TRI on for a triangle wave. Splice a **Scope** node into
> any cable to see the live waveform on its module; add a **Note** node
> for a real on-canvas text area to annotate the patch. Dropped modules
> never overlap in free layout, and loading a sample/library patch asks
> before replacing a patch in progress.
> **Right-click empty board space** for a categorized Add Node menu —
> the module spawns free-floating at the cursor, and also appears as a
> normal row in Controls ▸ Modulation's Beginner view (switching modes
> automatically so a fresh wire is always live). The VIDEO SOURCE
> module and the RENDER PREVIEW module both have expandable live
> monitors. A **PATTERN GENERATOR** module puts enable/kind/blend/mix
> in the bay too, with supporting-property knobs that change to match
> whichever kind is selected. New to the bay? **Help ▸ Patch Bay
> Tutorial** walks it all with try-it buttons. Try
> **Window ▸ Layout ▸ Patch Bay**.
>
> **ⓘ on every module, graph node and Controls section** opens a pop-up
> explaining what it does, how to patch it and every parameter it
> holds, with a link to the manual — topped by a live signal-flow
> diagram of what's plugged in and where its outputs go.
>
> **⧉ on any window bar** pops that window's view out to its own OS
> window for multi-display rigs, with its OWN tab bar and `+` so a
> popup isn't stuck with just the one view it opened with (Patch Bay/
> Timeline get a live duplicate; Controls/Renderer use their dedicated
> popouts). And the whole synth is remote-controllable over **MCP** — params, menu
> commands, the graph patch, screenshots — via **I/O ▸ MCP** plus the
> bridge in tools/mcp-server (opt-in; see its README).

1. On the welcome screen, pick a video source: **WEBCAM**, **SCREEN**, **FILE**, **STREAM URL**, or **PATTERN** — PATTERN (and **continue without video**) starts a moving Pattern Generator image that needs no camera, microphone or file. If a sample video has been deployed, a **Load Sample Video** button also appears in Video Source A → Video File.
2. Drag with the mouse to orbit. Scroll to zoom. Press \`R\` to reset the view.
3. Try a preset: open the **Presets** panel and click any chip ( *Phosphor Green*, *Burn-In*, ... ). *Noise Terrain*, *Lissajous Scope* and *Worley Cells* need no camera. A preset only changes the settings it names — your bindings, patch and layout stay put.
4. Open the **MIDI** or **Audio** tab to add reactive control.
5. Open the timeline strip at the bottom, hit **+ NEW**, drop preset chips onto the track to create scenes, then **PLAY**.

## No camera? Use the Pattern Generator

In the **Source** panel, scroll to **Pattern Generator** and flip **Enable** on.
That gives the synth a built-in "video signal" — pick **Sine Bands** or
**Oscilloscope** for the most musical result. Frequency, brightness, contrast,
and every other pattern parameter is modulatable: drop an LFO on
**Pattern: Frequency** and watch the stripes breathe.

## Prefer knobs? Panel skins

The **skin picker** in the panel title bar (CRT / HW / RACK) switches
between three looks. **HW** swaps the flat controls for a skeuomorphic
hardware panel — rotary knobs (drag vertically; hold \`Shift\` for fine
control), bat switches, LCD readouts. **RACK** adds modular chrome and
**live patch cables**: every modulatable knob grows an input and an
output jack, each
Classic mod slot gets an output jack, and dragging a cable between them
from the output into the input sets that slot's Target, exactly the same edit
as the Modulation panel's dropdown. Drop a cable in empty space to
unplug it. Drag a knob's output jack onto another knob's input to
modulate one parameter with another. Cyan cables show Graph-engine
bindings; grab one by its input jack to move or unplug it. Every cable
here is the same patch the Patch Bay shows. While dragging, the cable's end turns
red over a jack it can't go into, and a short note says why. Same parameters, same values in every skin; the choice is
remembered on this machine — it isn't part of your presets or projects.
Touch layouts keep their touch-friendly controls regardless of skin.

Separately, **View ▸ Theme** (or the MODERN/CLASSIC picker next to the skin
picker) switches between **Modern** (the default: neutral greys, a
system sans-serif, rounded surfaces, a soft green glow that follows the
pointer, pill buttons and iOS-style switches) and **Classic**, the
original green-on-black phosphor CRT look. The theme works with every skin and, like the skin,
is remembered on this machine only.

> Tip: the floating **?** button (bottom-left) re-opens this manual at any time.
`;

const MD_SHORTCUTS = `
# Keyboard shortcuts

## Globally
| Key | What |
|-----|------|
| \`R\` | Reset View — snaps to your saved default view |
| \`Shift+R\` | Hard Reset Camera — wipes saved view, returns to factory defaults, kills auto-orbit, exits fly mode |
| \`F\` | Toggle fullscreen |
| \`H\` | Toggle on-screen HUD |
| \`Ctrl+N\` | New Project — clears to defaults (prompts if unsaved) |
| \`Ctrl+O\` | Open Project — file picker for \`.synth.json\` |
| \`Ctrl+S\` | Save Project — writes back to the open file (or prompts for a name) |
| \`Ctrl+Shift+S\` | Save Project As — name + location prompt |
| \`Ctrl+Z\` | Undo (scenes AND lane edits) — works anywhere, not just over the timeline dock |
| \`Ctrl+Y\` / \`Ctrl+Shift+Z\` | Redo — same, works anywhere a timeline is loaded |

## When the timeline dock is hovered
| Key | What |
|-----|------|
| \`Space\` | Play / pause |
| \`←\` / \`→\` | Nudge playhead one beat |
| \`Shift+←\` / \`Shift+→\` | Nudge one bar |
| \`Home\` | Seek to bar 0 |
| \`,\` / \`.\` | Jump to previous / next keyframe |
| \`K\` | Add scene at the playhead (snapshots current settings) |
| \`Delete\` | Remove the selected scene |
| \`Alt+drag\` | Drag a scene or lane point without beat-snapping |
`;

const MD_MOD = `
# Modulation — two engines, one panel

The **Modulation** panel hosts two independent engines. Pick which is active
with the **Classic | Graph | Both** switch at the top.

- **Classic** is the original 4-slot matrix — fast to set up, easy to read.
- **Graph** is a free-form node graph — every signal is a value, every wire
  is a patch cord. Inspired by the original Rutt/Etra's voltage-control
  philosophy.
- **Both** runs them in parallel; effects on the same target sum together.
  Watch for the small dual-color dot next to a slider — it lights up when both
  engines are touching the same param.

## Classic in 30 seconds

Each slot routes a **source** to a **target** with an **amount**.

- **Sources**: sine / triangle / square / saw / pulse / ramp, audio envelope,
  audio band, beat pulse, MIDI CC, MIDI note, MIDI clock division, OSC,
  joystick, and a **constant** source for fixed-value patches whose amount
  you can modulate elsewhere.
- Click the small **▶** next to a slot's source dropdown to expand its
  source-specific controls (LFO depth, ramp loop, audio attack/release,
  joystick smoothing, …) plus a shared **Output** stage (curve, min/max,
  offset, invert).
- The **Sync** dropdown on a waveform slot is **Free / MIDI / Tempo** — pick
  Tempo to lock to the global **Tempo BPM** at the top of the panel; pick
  MIDI to lock to incoming MIDI clock pulses.
- Example: slot 1 → source **beat**, target **zPush**, amount **0.6**, then
  open the **Audio** panel, pick **mic**, and tap a kick. Relief jumps on every
  hit.

## Tuning a Classic patch

Every slot is a small voltage-control chain:

  **source → (per-source shaping) → output stage → amount → target**

The expanded body of a slot exposes each link:

- **LFO sources** get **Depth**, **Unipolar**, and a **Sync mode** dropdown.
  In *Free* mode the **Frequency (Hz)** knob is in charge; in *MIDI* or
  *Tempo* the **Division** dropdown takes over (1/4, 1/8, dotted, triplet…).
- **Ramp** has **Time**, **Mode**, and a **Loop** toggle. With Loop OFF the
  ramp becomes a one-shot envelope — hit **Retrigger** in the slot body to
  fire it again.
- **Audio** sources have their own **Attack / Release / Gain / Floor**
  follower so a kick-driven slot can use a fast envelope while a chord
  slot uses a long one. The Floor knob is a noise gate.
- **Joystick** sources get **Smooth (ms)**, **Deadzone**, and **Invert**.
- The **Output** group works on every source: pick a **Curve** (linear /
  exp / log / S / step), set the **Min/Max** range, add an **Offset**, and
  optionally **Invert** before the Amount knob hits the target.
- Click **C** to copy a slot, **V** to paste over the current slot, **X**
  to reset the slot back to its factory defaults.

If a slot is set to **MIDI** sync but no clock is being received, a
**NO CLOCK** badge appears under that row — the slot HOLDS at its last
known rate (no silent fallback to internal BPM).

## Graph in 90 seconds

The Graph engine is a directed-acyclic graph of nodes connected by named ports.
Every signal is a normalized scalar (-1..+1 by convention). Bindings sit at the
end of each chain and write into a Settings key.

1. Switch the panel to **Graph**.
2. Click the **Beginner** tab. Hit **+ Add patch**. Pick an LFO, a target
   (e.g. *Z Push*), and an amount.
3. Click the **Advanced** tab to open the full editor. The left palette adds
   nodes; the canvas hosts them; the right inspector edits a selected node's
   params and bindings.
4. Connect ports by clicking an output dot, then an input dot. Click an input
   dot alone to disconnect.
5. Drag a node by its header. Right-click (or press **Backspace** when focused)
   to delete it.
6. Hit the **Probe** button, then click any output port to scope its value
   over time.
7. Click **Library** to drop in a starter patch (audio ring mod, beat-synced
   sequencer, motion-triggered glitch, ...).

## Video as a control signal

Six **video-*** node types turn the input video into CV:

- **video-luma / video-edge / video-motion / video-color** — pick a region
  with the inspector's drag-rectangle thumbnail. Outputs are 0..1 averages.
- **video-luma-row / video-luma-col** — read a single scanline.

Open *Edge-Driven Focus* in the Library for an end-to-end example.

## Voltage control (CV) input

This synth can be driven by external analog voltages — from a Eurorack
modular, a CV-equipped synth, or any device that outputs control voltage.
The browser cannot read analog voltages directly, so CV must arrive
through one of four routes:

- **DC-coupled audio interface** (best fidelity) — interfaces like the
  Expert Sleepers ES-8 / ES-9, MOTU UltraLite, or some Focusrite Scarletts
  pass DC voltages through their audio inputs unchanged. Plug a CV into
  the interface, select that channel as a CV input in the **I/O → CV**
  panel, and it shows up as a source under both Classic (\`CV Input
  (audio)\`) and Graph (\`CV Input\` node) modulation. ±5V Eurorack-style
  CV is the default range; the panel lets you swap to 0–5V, ±10V, or
  0–10V to match other formats.
- **CV-to-MIDI converter** — modules like the Expert Sleepers FH-2 or
  Befaco CV Thing convert analog CV to MIDI CC. Lower resolution than
  direct CV but works with any standard audio interface. Use the existing
  **MIDI Learn** button to bind incoming CCs to parameters.
- **OSC bridge** — for custom hardware (RPi with ADC HAT, Norns, Bela,
  Teensy with USB serial), run a bridge script that reads voltages and
  emits OSC messages like \`/cv/1 0.234\`. The synth's I/O panel has a
  **CV Inputs (OSC bridge)** section; add a channel for each address you
  expect. See \`tools/cv-bridge/\` in the source tree for reference Python
  scripts targeting MCP3008 and ADS1115 ADCs on a Raspberry Pi.
- **Gamepad / MIDI controller** — not technically CV, but covers the same
  use case of physical knobs and sliders driving synth params. Plug in a
  gamepad and its axes / buttons appear as sources (\`Gamepad Axis\`,
  \`Gamepad Button\`).

### Quick setup (DC-coupled interface)

1. Plug your CV source into channel 1 of your DC-coupled audio interface.
2. In **I/O → CV**, pick your interface from the dropdown and click
   **Start CV input**.
3. Watch the channel 1 readout — it should show your CV value in volts
   and react when you move the source.
4. In Modulation, add a patch with **Source = CV Input (audio)**,
   **Channel = 0**, **Target = whatever you want to control**.

### Calibration

If your CV source has a DC offset (e.g., outputs 1V at "rest"), click the
channel's **Calibrate** button to capture the current value as zero —
movements relative to that zero are then centered. Shift+click clears
calibration. The expanded slot row in Modulation has a Calibrate button
too, so you can recalibrate without leaving the patch.

### CV Learn

In an expanded patch row with a CV input source, click the **Learn**
button and wiggle a CV. The system watches every channel for ~2 seconds
and binds the channel that moved the most — same UX as MIDI Learn.

### Gotchas

- **AC-coupled interfaces** filter out slow voltages: a steady CV will
  drift toward zero over a few seconds. Test by sending a steady voltage
  and watching a channel readout — if it sags, your interface is
  AC-coupled and direct CV won't work. Use a CV-to-MIDI converter
  instead.
- **Eurorack CV is typically ±5V**; some sources are 0–5V (gates,
  envelopes) or ±10V (industrial). Set the channel's voltage range to
  match.
- **Firefox** clamps multi-channel input to 2 channels in many configs.
  The CV panel surfaces a warning when that happens; use Chrome or Edge
  for full multi-channel CV.
- **Audio interface disconnected mid-session** — channels zero out and
  the section shows an "Audio interface disconnected" status. Reconnect
  and click **Start CV input** to resume.

## Voltage control (CV) output

Symmetric counterpart to CV input: the synth can SEND control voltages
out to your modular or external hardware. Any synth parameter,
modulation source, or graph node can be routed to a CV output channel.

**Requirements**:
- A DC-coupled audio interface (Expert Sleepers ES-3/8/9, MOTU
  UltraLite, etc.) — same as CV input.
- Spare output channels on that interface (you'll want at least 1 or 2
  for audio monitoring; the rest can be CV).

### Quick setup

1. In the I/O tab, find **CV Out**.
2. Pick the DC-coupled interface from the dropdown and click
   **Start CV output**. The first click also satisfies Chrome's
   "user gesture before AudioContext" requirement.
3. Click **+ Add output** — a new channel appears using the next free
   index.
4. Pick a **Type** (cv, gate, trigger, clock, pitch).
5. Pick a **Source**:
   - **Constant value** — useful for testing. Just emits a fixed
     voltage.
   - **Classic slot** — a Classic patch's post-output value.
     <i>Also</i> set that slot's Target to "CV Out: Ch N" — the slot
     drives the channel directly through the routing token.
   - **Graph node** — by id + port. Or, more cleanly, drop a
     **CV Output** node in the graph and set its channel parameter.
   - **Settings param** — emit any modulatable param's live value
     (so the wire mirrors what the synth is currently doing).
   - **MIDI note** — for pitch type, the last incoming MIDI note.
   - **Auto** — for clock type, follows the internal BPM.
6. Click **Test** to send +2.5V steady. Confirm with a multimeter, or
   patch the channel into an oscillator and listen for the offset.
7. Click the **Enable** checkbox to start sending live.

### Output types

- **cv** — continuous voltage tracking the source. Use for envelopes,
  LFOs, parameter automation.
- **gate** — high/low based on threshold. Use for triggering envelope
  generators, sequencers' Run inputs.
- **trigger** — short pulse on rising edges (default 10ms at 5V). Use
  for drum triggers, sample-and-hold clocks.
- **clock** — square-wave clock at a tempo division. Use for syncing
  external sequencers and clocks. Source = internal BPM by default.
- **pitch** — 1V/octave pitch CV. Use for sequencing external
  oscillators from MIDI input, the timeline sequencer, or a graph
  sequencer node.

### 1V/octave pitch output and calibration

\`voltage = referenceVoltage + ((midiNote − referenceNote) / 12) × voltsPerOctave\`

Default: reference C4 (note 60) → 0V, 1.0V/oct. So note 72 (C5) → 1V,
note 48 (C3) → −1V, note 61 (C#4) → 0.0833V.

Modular tuning is sensitive: a 1% scaling error compounds across
octaves — 5 cents off at C5 becomes 25 cents off at C9. The **Calibrate
Pitch** button opens a panel with **Play C2** / **Play C6** buttons and
a **Scaling trim** slider. Tune your oscillator to C2 by ear or with a
tuner, then play C6 and adjust the trim until C6 is also in tune. The
trim is a multiplier on V/oct (factory: 1.0; ±5% covers nearly all
interface drift). Most Expert Sleepers interfaces are factory-calibrated
and don't need this.

### Routing (Chrome and friends)

The CV output AudioContext uses \`setSinkId\` to target the chosen
DC-coupled interface. A \`ChannelMergerNode\` sized to the interface's
channel count fans each channel's worklet to a specific hardware output.
Audio output and CV output are on **different AudioContexts**, so the
synth's audible mix never bleeds into CV channels — they are physically
isolated.

- **Chrome / Edge**: \`setSinkId\` on AudioContext is supported. Pick
  the interface in the dropdown and you're done.
- **Firefox**: \`setSinkId\` on AudioContext is not supported. The
  status line surfaces this; use OS-level audio routing (Loopback on
  macOS, VoiceMeeter on Windows, JACK / PipeWire on Linux) to pin the
  browser's output to your DC-coupled interface.

### Safety

Two guards prevent damaging external gear:

- **Hard sample clamp** in the audio worklet — every sample is clamped
  to ±1.0 before being written. A bug in the source pipeline cannot
  produce a 50V swing on the wire.
- **0V startup ramp** — every channel starts at 0V on enable and ramps
  to its target over 100ms. Saved configurations restore the channel
  configs but **\`enabled\` is forced to false on every page load**;
  you must re-arm each channel before any voltage actually leaves the
  interface. Prevents click/pop and unexpected jumps when hardware is
  already physically connected.

### Gotchas

- **CV output has the same latency as your audio interface** — typically
  20–50ms. Fine for LFOs and envelopes; borderline for tight drum
  triggers. For sample-accurate triggers, consider a hardware
  MIDI-to-CV converter driven by Web MIDI instead.
- **AC-coupled interfaces will not work** for slow CVs (sag toward 0V),
  for the same coupling reasons as CV input. DC-coupled outputs are
  required.
- **Eurorack gear is generally tolerant of voltage overshoot** but some
  hardware isn't. The synth clamps every sample to your configured
  voltage range as a safety measure, and ramps from 0V on enable to
  protect against pops on patch.

## Sonification (hear the image)

The synth can produce audible sound driven by what's happening
visually. This is faithful to a 1970s video-art technique — Steina
Vasulka and Bill Hearn would route video signals through audio
amplifiers to literally hear the image. Bright visuals produce sound;
dim visuals produce silence; motion produces variation.

Sonification is one audio voice — a single oscillator, filter,
amplifier — whose parameters are driven by statistics computed from
the scanline mesh. It's not a synth in the conventional sense; it's
the visual signal made audible.

This is the synth's first audible-output feature. Everything else
under I/O reads audio IN (envelope follower, FFT, beat detector); the
Sonification voice writes audio OUT.

### Enabling

Sonification is **off by default**. Open the I/O panel, find the
**Sonification** section, click **Enable**. Audio starts at -18 dB
with a 500ms fade-in; raise **Master Volume** to taste.

The Enable click also satisfies the browser's autoplay policy — that's
the natural user gesture. If the toggle is flipped some other way
(URL config, programmatic load), a "click anywhere on the canvas to
start audio" indicator appears in the section.

### Default mapping

Out of the box:
- **Pitch** ← vertical position of brightness (high in frame = high
  note; logarithmic / Exponential curve so octaves feel even)
- **Amplitude** ← overall brightness (bright = loud)
- **Cutoff** ← brightness contrast (high contrast = filter opens)
- **Resonance** ← motion (waving a hand makes the filter ring)

This combination produces a voice that varies expressively with the
visual content without needing configuration.

### Customizing the mapping

The Mapping section lets you assign any of the available mesh
statistics to any of the voice parameters.

Available stats:

- **Mean Brightness** — overall brightness of the mesh
- **Brightness Variance** — contrast (high when scene has both bright
  and dark parts)
- **Vertical Centroid** — Y position of brightness center-of-mass
- **Horizontal Centroid** — X position of brightness center-of-mass
- **Mesh Activity** — how much the visual is changing frame-to-frame
- **Peak Row** — Y position of the brightest scanline
- **Peak Brightness** — brightness value at the peak row
- **Edge Density** — fraction of rows with strong row-to-row brightness
  changes (fine detail / texture estimate)

Voice params that can be driven:

- **Pitch** — oscillator frequency, optionally quantized to MIDI
  semitones within the configured range
- **Amplitude** — voice level
- **Cutoff** — filter cutoff frequency (60 Hz to 16 kHz, exponential)
- **Resonance** — filter Q

### Mapping curves

Some mappings sound more "musical" with curves applied. Pitch defaults
to **Exponential** because human pitch perception is logarithmic —
exponential mapping makes pitch sweeps feel even across octaves.
Amplitude works fine **Linear**. **S-Curve** (smoothstep) flattens
both ends and accentuates the middle. **Logarithmic** (sqrt)
amplifies low values, useful for low-brightness scenes that would
otherwise stay near silent.

### Smoothing

The Smoothing slider sets a single 1-pole lowpass time constant
applied to every stat → param mapping. At **5 ms** the audio twitches
on every visual frame. At **200 ms** it glides smoothly through visual
changes. **40 ms** (the default) is responsive but not jittery.

### Common patches

- Default mapping with smoothing at 80 ms and Pitch range C3–C5 —
  gentle, musical accompaniment to most visuals.
- Pitch ← peakRow, Amplitude ← peakBrightness, smoothing 5 ms —
  twitchy, percussive tracking of the brightest point.
- Pitch ← meshActivity, Cutoff ← edgeDensity, Quantize off — drone-like
  with formant motion.
- All four params ← meshActivity — silent except during motion, then
  bursts of sound.

### Recording and broadcasting

Sonification audio is captured in **recordings** and **broadcasts**
when enabled. The capture tap is post-master and post-limiter, so
the recorded / streamed audio is exactly what you hear.

If you don't want sonification audio in your recording, disable it
before pressing Record.

If you also have **Mic** enabled in the Record section, both audio
sources are mixed together by the browser. Same for broadcasts.

### Safety / gotchas

- **The synth makes no sound by default.** First page load is silent;
  every preset / settings restore forces \`sonification.enabled = false\`.
  Audible output always requires an explicit Enable click.
- **Default master volume is -18 dB.** Quiet by design — you can turn
  it up; you won't be blasted by an existing config that opens at high
  level.
- **Hard limiter at -3 dBFS** — a DynamicsCompressorNode with 20:1
  ratio sits between master gain and your speakers as a brick wall.
  A resonant filter sweep on a high-amplitude voice cannot produce
  values above unity at the output.
- **Mic-feedback gate** — if the audio envelope follower is using mic
  input AND sonification is enabled, the synth auto-mutes the
  sonification voice with a banner explaining why. Turning off
  mic-as-envelope-source clears the gate. We refuse to ship a
  feedback loop.
- **Browser autoplay** — the Enable click is the natural user gesture.
  If sonification ever wants to be running but the AudioContext is
  suspended (e.g. URL-driven config), a "click anywhere on the canvas
  to start audio" banner appears. The next click resumes the context.
- **Test Tone** plays a 440 Hz sine for 1 second at -18 dB regardless
  of mesh state. Use it to confirm the audio chain is alive before
  diving into "why isn't there sound?" debugging.
- **Mute Briefly** drops master to silence for 2 seconds, then ramps
  back. Useful while patching when you want a quiet moment without
  losing your config.

## Coexistence

In **Both** mode, Classic and Graph write to the same Settings keys; their
effects sum. The dual-color dot on a slider tells you when this is happening.
Switching to **Graph** silences Classic immediately and vice versa — old
values are preserved, the engines just stop pushing.

## Converting Classic to Graph

The bottom of the Classic body has a **Convert to Graph →** button. It builds
an equivalent graph patch (one source node + one binding per enabled slot)
and switches you to Graph mode. Your Classic slots are left untouched, so you
can flip back any time.

## Probing & feedback delays

Inputs feeding back into themselves get an **implicit one-frame delay** — the
engine breaks the cycle automatically so a feedback patch never locks up.
Use a **Delay** node to make the latency explicit and tunable.

## Built-in starter patches

Open **Library** in the Graph view, or **File ▸ Load Sample Patch** in the
top menu bar, to load any of: Getting Started — Breathing Z Push, Annotated:
Audio-Reactive Bloom, Audio Ring Mod, Video Brightness Tracking, Beat-Synced
Step Sequencer, Motion-Triggered Glitch, Slewed Pitch Follow, Reactive
Crossfade, Edge-Driven Focus. The first two ship with a **Note** node
explaining themselves.

## Notes

A Meta-category node with no inputs, outputs, or signal effect — just a
free-text box you type into directly on the canvas, for documenting what a
patch does. Add one from the palette any time; it never affects playback.
`;

const MD_TIMELINE = `
# Timeline / Scene Sequencer

A horizontal dock at the bottom of the screen. Two layers compose:

- **SCENES** (top track) — full-settings snapshots interpolated over time.
  A scene sets *everything*.
- **Lanes** (rows below) — per-parameter automation that rides on top.
  A lane animates *one knob*, as a relative offset summed with its base
  value (like CV into an input).

## Scene workflow
1. Click **+ NEW** in the transport.
2. Drag a preset chip from the Presets panel onto the track to drop a scene.
3. Drag the block markers to move scenes. Hold \`Alt\` to disable beat-snap.
4. Click a marker to edit its **easing**, lock state, or name in the inspector.
5. Hit **PLAY**.

## Lane workflow
- Click the **◇ diamond** next to any modulatable slider in the panel to
  keyframe it at the playhead — first click creates the lane, later
  clicks add or remove points. Filled ◆ = point at the playhead. Once a
  param has points, **◀ ▶ arrows** appear beside the diamond to jump the
  playhead to its previous/next keyframe without leaving the panel.
- Or add lanes in the dock with **+ Lane**, then **double-click** a lane
  row to add points. Drag points in 2D: horizontal = bar (beat-snapped,
  \`Alt\` = free), vertical = value.
- Lane curves draw in **absolute values** on the param's slider range —
  the same numbers as the panel knob. The dashed line is the knob's
  base value; a MIDI/OSC binding or a preset load can still shift the
  base (and the whole curve with it) but the panel knob itself never
  does once a lane exists — see auto-key below.
- Right-click a point for per-point **easing** or delete; right-click the
  ◇ diamond in the panel for *Open in timeline* / *Remove automation*.
- The inspector shows the selected point's bar and **value** (matching
  the knob), with a base ± offset breakdown underneath.
- While a lane drives a parameter, its panel slider turns **amber** and
  shows the actual value at the playhead. Fast modulation on top
  (LFO / CV / audio) appears as a small amber ▸ readout above the slider.
- **Auto-key**: once a param has a lane, the knob is always keyed
  (Blender/Resolve, Ableton/Pro Tools "write" convention). On an
  existing keyframe it rewrites that keyframe. Off one, it plants a
  **new** keyframe at the playhead. Either way every other keyframe
  and the base are untouched — the base only moves for a param with no
  lane at all.
- The checkbox on a lane's chip mutes it; the target snaps back to its
  base value instantly.

## Resizing the dock and panel
- Drag the dock's **free edge** (top edge when docked at the bottom) to
  change its height (140–600 px). Drag the inspector column's left edge
  to resize it (180–420 px).
- Drag the side control panel's **inner edge** to change its width
  (280–600 px). All three are remembered across sessions.

## BPM and bars
Set BPM, beats-per-bar, and total length in the transport. Switch **SYNC** to
**MIDI** to follow incoming MIDI clock instead of the internal BPM.

## Counter display format
The **DISPLAY** dropdown next to the transport's counter switches how the
playhead position is shown: **Bars/Beats** (the real clock), **Timecode**
(\`HH:MM:SS:FF\`), **Frames**, or **Samples**. Only Bars/Beats is the actual
clock — the rest are display-only conversions (a picker for fps or kHz
appears alongside them) and never affect playback, editing, or snapping. The
**LENGTH** field follows the same setting (seconds/frames/samples instead of
bars) and converts back to the real bar count when you edit it. BPM/LENGTH/
B-BAR all support click-to-type, drag-to-scrub (Unity-style: click focuses,
drag up/down adjusts, \`Shift\` = fine).

## Timeline track scroll & zoom
Once a zoomed-in track is wider than the dock, plain wheel scrolls lane rows
vertically as usual; **Shift+wheel** pans horizontally; **Ctrl/Cmd+wheel**
zooms, anchored to the bar under the cursor (Premiere/Blender/Resolve
convention) — same as the transport's \`−\`/\`+\` buttons, just continuous.

## Recording a timeline
The **Record** panel has a **Record Timeline** button: it seeks to bar 0,
disables looping for one pass, plays the timeline, and downloads a video named
after the timeline when it reaches the end.

## Adding scenes

Three ways to add a scene at a position on the track:

- **Double-click** empty track space (recommended — works on all platforms)
- **Ctrl+click** (Cmd+click on Mac) empty track space
- **Right-click** empty track space → "Add scene at bar …" (may be intercepted by system features on Windows with tablet / pen / touchpad drivers)

## Scene context menu
Right-click any scene marker for: preview, **replace snapshot with current**,
duplicate, lock, change easing, or delete.

## Excluded parameters
Camera position, source kind, recording settings, and panel UI flags never
animate via scenes. Edit \`excludedParams\` on a timeline if you want a
different list. Lanes are exempt — they're explicit per-param opt-ins.
`;

const MD_ANAGLYPH = `
# Anaglyph 3D

Render the synth in **red-cyan anaglyph** — the classic 3D format viewed with
standard red-cyan glasses. The left and right eye views are colour-separated
and composited directly onto the main canvas using Dubois matrices, which give
more accurate colour preservation than simple channel-splitting.

## Controls

| Control | Description |
|---------|-------------|
| **Enable** | Switches the canvas to anaglyph mode. Toggle off to return to normal view. |
| **Eye Sep (cm)** | Inter-pupillary distance in centimetres. Default 6.4 cm matches average human IPD. Increase for stronger depth; decrease to reduce eye strain on close objects. |

Both controls are in the **Virtual Camera → Anaglyph 3D** group.

## What works in anaglyph mode

- All synthesizer parameters (scanlines, mesh, warp, modulation, sequencer)
- Recording — the exported video is an anaglyph file playable with any video
  player when viewed with red-cyan glasses
- WHIP / canvas-capture streaming — the stream carries the anaglyph image
- Side-by-side stereo recording (from the Record panel) — operates on its own
  offscreen canvas and is unaffected by anaglyph mode

## What is paused

- **Post-processing** (bloom, CRT overlay, feedback) — bypassed while anaglyph
  is active, the same trade-off as WebXR. Postfx return when you disable
  anaglyph.

## Tips

- Red-cyan glasses are inexpensive and widely available. Cardboard clip-ons
  work fine for casual viewing.
- If depth feels too strong or causes eye strain, reduce **Eye Sep** toward
  3–4 cm.
- The **Eye Sep** here is tuned independently from the **IPD (cm)** slider in
  the Record panel's Stereoscopic 3D group — you can use different values for
  live viewing and offline rendering.
- Anaglyph and WebXR should not be enabled simultaneously; disable one before
  starting the other.
`;

const MD_XR = `
# WebXR — VR and AR headsets

This synth supports viewing in VR headsets and AR passthrough devices. The
headset shows you the same running synth that's on your desktop screen —
edits you make on the desktop appear in the headset in real time.

To use it: connect a WebXR-capable headset (Meta Quest with Quest Link,
SteamVR-compatible device, Apple Vision Pro), open the **XR** section in
the control panel, and click **Enter VR** or **Enter AR**. The browser
will ask for permission the first time.

In **VR**, the synth appears in a black void at the scale you choose. You
can walk around it (in roomscale) or stand still and look. The mesh
exists in three dimensions — what looks flat on your monitor is actually
a terrain you can move through.

In **AR** (on devices that support passthrough — Quest 3, Vision Pro,
others), the mesh appears in your physical room. The synth becomes part
of your space rather than a separate world.

## Mesh scale

| Preset | Roughly | Use when |
|--------|---------|----------|
| Tabletop | desk model, 1m ahead at chest height | seated, browsing, default |
| Roomscale | 3m × 2m × 1.5m volume ahead | you have a clear roomscale area |
| Architectural | 10m × 6m × 4m | you want to be dwarfed; stand still |

Change scale before entering or mid-session — the mesh re-frames in place.

## Performance

XR rendering is stereo at headset refresh rate, roughly doubling GPU cost.
**Balanced** is the default. **Auto** picks based on a headset hint (Quest 2 →
battery, Quest 3 → balanced, PCVR → quality). The XR session uses a
separate profile from your desktop profile, and your desktop profile is
restored when the session ends.

If you change your desktop profile during an XR session, your new choice
is preserved on session end and a toast confirms it.

## What stays editable

Everything. The desktop UI continues to function while you're in the
headset — alt-tab or reach over to the keyboard to edit the DCU, drop
modulation, load a preset, scrub the timeline. All edits appear in the
headset view immediately because there's only one synth instance.

## Ending the session

Remove the headset, click **Exit XR**, or close the browser tab. Hiding
or minimizing the tab also ends the session by default (toggleable via
the \`xrAutoEndOnVisibilityChange\` setting). Your synth state is exactly
where you left it.

## Supported browsers

| Browser | Support |
|---------|---------|
| Chrome / Edge (desktop) | Full — VR + AR via connected headset |
| Quest browser (native)  | Full — but a future "two-browser" stage |
| Vision Pro Safari       | AR; VR varies |
| Firefox                 | Limited — may not work |
| Safari (macOS)          | Not supported |

Postfx (bloom, CRT, feedback) is skipped in headset for v1 — the raw
mesh in stereo is its own aesthetic. Per-eye postfx will return as a
later stage.
`;

const MD_STEREO = `
# Stereoscopic 3D recording

The synth can record stereoscopic 3D video — a side-by-side video file
with separate left- and right-eye views. Uploaded to YouTube, viewers
can play it back in VR headsets, anaglyph (red/cyan glasses), 3D TVs,
or as flat video. One file, multiple playback modes.

To enable: open the **Record** section, check **Enable stereoscopic
recording**, and start recording as usual. The output file is twice as
wide as a normal recording (3840×1080 for Full HD) and contains the
left view on the left half, right view on the right half.

## IPD — how strong the 3D effect is

**IPD** (interpupillary distance) controls the offset between the two
eye cameras. The default **6.3 cm** matches average human eye spacing.
Smaller values produce a subtler effect (good for viewers who find
strong stereo uncomfortable). Larger values produce more dramatic
depth — past about 10 cm the effect gets uncomfortable for most
viewers but can be useful for tight scenes.

The cm value is converted to world units based on the mesh's actual
size, so a 6.3 cm IPD looks the same on screen regardless of how you
have the mesh scaled.

## YouTube metadata

**Inject YouTube 3D metadata** is on by default. With this enabled,
the exported MP4 file is automatically tagged so YouTube recognizes
it as 3D and offers viewers the appropriate playback modes. The tag
is a standard \`st3d\` box per Google's spatial-media spec, added to
the MP4 container after recording stops.

If you're editing the file in other software before uploading, you
may want to turn this off and let your editor manage the metadata.

## When MP4 isn't available

YouTube's auto-detection requires MP4. On browsers that don't support
MP4 recording (Firefox, older Safari), the synth still records the
side-by-side file — it just comes out as WebM. A toast on stop
explains what happened and points you at YouTube Studio's manual 3D
flag (**Editor → 3D**) so the file still uploads as 3D, just with
one extra click instead of zero.

## Preview before recording

The **Preview stereo (3 s)** button switches the main viewport to
side-by-side rendering for three seconds. Use it to check the stereo
effect before committing to a long take — IPD too aggressive, camera
roll throwing the stereo off, all visible immediately.

## Output dimensions and performance

The Record section shows the exact output dimensions for your current
Resolution preset. At Full HD that's 3840×1080. At 4K it's 7680×2160
— large enough that some browser encoders refuse it; you'll see a
warning in the section if you're set up to attempt it.

Stereoscopic recording renders the scene **twice per frame**, roughly
tripling per-frame render cost. The synth defaults to 30 fps for
stereo recording (vs 60 mono) and the Balanced performance profile is
a good companion if your frame rate drops noticeably.

## Postfx is not applied to stereoscopic output

Same architectural reason as XR: \`EffectComposer\` doesn't compose
with per-eye stereo rendering without significant work, so v1 ships
raw mesh in stereo. The mesh-in-stereo aesthetic is its own thing —
clean wireframe geometry without the desktop CRT signature.

Per-eye postfx is a future stage — same engineering work as per-eye
postfx in XR, and they'll likely land together.
`;

const MD_PROJECT = `
# Project — save your work

The synth has three save formats at three different scales. Choose
based on what you want to keep or share:

- **Preset** (\`.preset.json\`) — saves a *look*. The DCU controls,
  modulation patches, color and effects, the camera's default view.
  Small file, easy to share. Use this when you want to share a visual
  configuration with someone else.
- **Timeline** (\`.timeline.json\`) — saves a *score*. A sequence of
  preset keyframes over musical time, with BPM and sync settings.
  Use this to compose pieces that morph between configurations over
  bars and beats.
- **Project** (\`.synth.json\`) — saves your *whole workspace*. The
  active preset, the current timeline, your MIDI bindings, OSC
  bindings, CV calibrations, sonification config, panel layout,
  camera position, resolution settings, performance profile.
  This is the "save your work" format. Use it when you want to come
  back tomorrow and be exactly where you left off.

Most of the time you'll save a Project. Presets and Timelines are
for sharing — when you've made something you want to give to someone
else, export just the preset (or just the timeline) so they can load
it without needing your hardware setup or your MIDI bindings.

## Saving a project

1. In the **Project** section at the top of the synth tab, click
   **Save As…**.
2. Enter a name. The file downloads as \`{name}.synth.json\` (or, on
   Chromium browsers with the FS Access API, opens a save dialog).
3. The title bar updates to show \`{Project Name} — RUTT/ETRA\`.
4. Subsequent **Save** clicks (or \`Ctrl+S\`) write back to the same
   file without prompting.

Title-bar dirty marker: when you've changed any setting since the
last save, an asterisk appears next to the project name —
\`{Project Name} *\`. The marker clears the moment you save.

## Opening a project

1. Click **Open…** (or press \`Ctrl+O\`), pick a \`.synth.json\` file.
2. The synth restores the preset, timeline, bindings, configurations,
   and layout.
3. **Hardware-output features** (CV outputs, sonification, mic input)
   load their configs but stay **disabled** — re-enable them
   explicitly to start producing output. This mirrors the
   "always-off-on-load" rule everywhere else in the synth: nothing
   that produces sound or sends voltage auto-arms from a saved file.
4. A toast summarizes what was restored:
   *Loaded "Session 1" — 3 MIDI bindings, 2 CV channels (disabled),
   sonification ready (disabled), 8 timeline keyframes.*

## Auto-save and recovery

Toggle **Auto-save every 60 s** in the Project section to write the
current project to browser storage every minute (and once more when
the tab closes). If your tab crashes or you accidentally close, the
next page load offers to recover unsaved changes. With Auto-save off,
nothing is written and no recovery prompt appears.

If saved state ever stops the page from loading, open the site with
\`?reset\` on the end of the address: everything the app keeps in
browser storage is cleared (a copy is kept under \`ruttetra-backup\`)
and the page reloads fresh.

Auto-save is a safety net, not a primary save — explicit Save to
file is still how you preserve work permanently. Browser storage is
session-scoped (from the browser's perspective) and can be cleared
without warning.

## Recent Projects

The Project section lists the last 8 projects opened.

- **Chromium browsers (Chrome, Edge, Brave, Opera)**: recent entries
  written *during the same session* re-open in one click thanks to
  persistent file handles from the FS Access API.
- **Firefox / Safari**: the menu shows project names but the file
  picker opens when you click — pick the file again. The synth can't
  remember a path on these browsers because the Web platform doesn't
  expose one.

## Sharing vs preserving

A common workflow: you build something good in a Project. You want
to share the look but not your MIDI setup.

From the current project, click **Save preset from project
(.preset.json)** — exports just the preset portion as a
\`.preset.json\` that anyone can load without needing your hardware.
The project file stays on your machine; only the preset goes out.

## Recovered Session

The very first time you load the synth after the Project feature
shipped, if you had pre-Project state in browser storage (a saved
preset, user presets, or timelines), the synth packages all of it
into a Project named **Recovered Session** and offers to restore it.
One-shot — subsequent loads don't keep re-creating it.

If you decline the prompt, the snapshot is discarded. If you accept,
save it to file with **Save As…** to preserve permanently.

## Conflict resolution

Opening a project (or starting a new one) while you have unsaved
changes triggers a confirm prompt. The choices are standard:
proceed and lose the changes, or cancel and keep editing.

## Format & migration

\`.synth.json\` is a single JSON document with a \`formatVersion\`
field. The project loader checks the version and runs migrations on
read. Saving back always writes at the current format version,
regardless of what version the file came in at — so an older project
opened, edited, and saved is now a current-version project.

The file is **self-contained**: no external references, no relative
paths, no "load this preset from disk" indirection. You can drop a
\`.synth.json\` into any cloud storage and it'll round-trip
identically.
`;

const MD_TIPS = `
# Tips & gotchas

- **Webcam permission denied.** Click the address-bar lock icon and grant camera permission, then reload. Some browsers block webcam on \`http://\` — use \`https://\` or \`localhost\`.
- **Black screen but FPS is fine.** Check the **Video Source A** panel; the active source might be paused or disconnected. Reconnect from the Source panel.
- **MIDI device not listed.** Web MIDI requires a secure context (\`https://\` or \`localhost\`). Safari ships an experimental flag.
- **OSC won't connect.** Start the bridge in \`tools/osc-bridge/\` — see its README. Default URL is \`ws://localhost:8081\`.
- **Recording produces tiny files.** Some browsers don't expose \`MediaRecorder\` for canvases at high resolution. Try lowering FPS or switching format to \`webm-vp8\`.
- **Timeline doesn't move.** Make sure you have **at least 2 keyframes** and that the selected timeline is the one in the picker (drop the dropdown, pick it).
- **Help panel keeps opening.** Toggle **Don't auto-open** in the *Quick start* tab.
- **My Classic patch stopped working when I switched to Graph.** The mode switch is exclusive: \`Graph\` silences Classic, \`Classic\` silences Graph. Pick **Both** if you want them to run together.
- **Video nodes always read 0.** The Graph engine only constructs a \`VideoTap\` once you switch to Graph or Both mode — make sure a video source is actually playing in the **Source** panel.
- **A patch is humming / oscillating.** Feedback loops get an implicit one-frame delay, but the loop's gain still matters. Add an attenuator (or a longer **Delay** node) inside the loop to tame it.
- **Probe shows nothing.** The probe overlay reads the engine's last frame; if the patch is empty, mode is \`classic\`, or the source node has no input wired, it'll just sit at 0.
- **Beginner view says my patch is too complex.** Open Advanced view to keep editing. Beginner only handles linear chains of source → optional 1-2 processors → binding.
- **Camera rotation is unconstrained** — you can orbit completely over the top, underneath, or behind the raster. If the world ends up rolled at an awkward angle, click **Reset Up** in the Virtual Camera panel (or use **Hard Reset Camera** / \`Shift+R\` to fully clear it back to factory defaults).
- **Camera got stuck or pointer-locked weird?** \`Shift+R\` is the escape hatch — it releases pointer lock, kills auto-orbit, switches back to Orbit mode, wipes any saved default, and snaps every value to factory defaults.
- **Set Resolution to Full HD or 4K before recording** for consistent output dimensions regardless of your browser window size. The recorded video will be exactly the selected resolution.
- **Render Scale is a multiplier on the chosen resolution.** 4K × 0.5 scale renders 1080p internally and upscales — fast performance recovery if your GPU is struggling, with no change to the recording dimension story.
- **Letterbox fit guarantees pixel-accurate recording.** Fill or Stretch can crop or distort the render when the window doesn't match the preset's aspect ratio. Use Letterbox for predictable recording output.
- **Custom resolution on mobile may be slow.** On compact/touch devices the Resolution dropdown caps selectable options at Full HD. Higher presets are still listed but grayed out.
- **There is one BPM.** The Tempo BPM at the top of the Modulation panel is shared by the Timeline, every Classic LFO in Tempo sync mode, and the Graph Clock node — change it once and it's reflected everywhere. The Timeline transport's BPM input is now just a window onto the same value.
- **MIDI sync without a clock holds at the last known rate.** If you select MIDI sync on a slot but never plug a clock in (or your DAW stops sending one), the slot doesn't silently fall back to the internal BPM. The **NO CLOCK** badge under the slot warns you. Switch to Tempo sync if you want it to follow the global BPM, or to Free for a fixed Hz.
- **One-shot ramps.** Turn the Ramp slot's **Loop** toggle off to make it run once and hold. Hit the slot's **Retrigger** button (or assign it via MIDI) whenever you want to fire the envelope again.
- **Use the slot's Output stage to fit a parameter's range.** Set Min / Max to clamp the swing, Offset to bias the result around a non-zero rest value, and the Curve dropdown to bend the response without baking the curve into the source itself — handy when re-routing the same LFO to several params with different feels.

## Pattern Generator (synthesized source)

The **Source** panel's Pattern Generator group is an independent video-signal layer parallel to webcam / screen / file. The **Enable** toggle styles itself the same way **Mirror H** / **Mirror V** do — patterns are a layer you turn on, not a mode you switch into.

- **Kind** picks the generator: Calibration (Solid / Gradient / Bars / Grid / Checker), Waveform (Sine / Triangle / Saw / Square / Pulse Bands, Lissajous, Spiral), Noise (White / Perlin / Worley), or Oscilloscope.
- **Blend** and **Mix** describe how the pattern combines with whatever video source is active. *Replace* hides the video; *Multiply* / *Screen* / *Mask* etc. composite. *Crossfade* is a clean A/B between video and pattern.
- All numeric per-pattern parameters (frequency, brightness, contrast, scale, octaves, scope sweep, ...) are full **modulation targets** — they appear in the Classic slot and Graph cv-output target lists under the **Pattern:** prefix.
- The **Oscilloscope** kind renders any signal you can sample (audio, a Classic mod-matrix slot, a Graph node port, a numeric Settings key, BeatDetector pulses) as a phosphor trace. The trace itself becomes the input to the DCU, so Z Push will then displace the synth surface along the *shape of your signal*. This is the most Rutt-faithful generator: the original 1974 hardware was famously a hijacked oscilloscope.
- All pattern controls remain editable when **Enable** is OFF — you can wire up a full pattern + modulation patch first, then flip the layer on.

### Patterns publish their own modulation signals

Every pattern's internal control signals are exposed back to the modulation system, so you can treat the pattern as a video source AND as an LFO at the same time:

- **Lissajous** publishes \`Lissajous X\` and \`Lissajous Y\` — the two oscillators that draw the curve.
- **Sine / Triangle / Saw / Square / Pulse Bands** publish \`Wave\` — the underlying waveform at the configured frequency.
- **Spiral** publishes \`Phase\`; **Gradient** publishes \`Ramp\`.
- **Oscilloscope** publishes \`Latest\` (the most recent sample), \`Mean\` (running mean of the visible window), \`Peak\` (running peak), and \`Trigger\` (a one-frame pulse on rising-edge crossings).

How to use them:

- **Classic mode** — open a slot's source dropdown and pick from the **Pattern Outputs** group: e.g. *Pattern: Lissajous X* → Z Push wobbles in lockstep with the visible curve's horizontal motion.
- **Graph mode** — drop in a **Pattern Output** node and pick a signal from its dropdown. Wire it through Slew → Output(BloomIntensity) to make bloom follow the scope's mean envelope, for instance.
- **CV out** — set any CV-output channel's source to **Pattern output** and pick a signal. An external hardware oscilloscope can then display the same Lissajous X the synth's visual layer is drawing.

The pattern shader and the published scalar signal share the same parameter state — modulating Frequency moves both the visible bands and the wave output in lockstep, by construction.
`;

const MD_ABOUT = `
# About

**Rutt/Etra Web** — a free, open-source homage to the Rutt/Etra Video Synthesizer
designed by Steve Rutt and Bill Etra in 1974. The original was an analog
oscilloscope-modulating monster; this is a 60-fps WebGL recreation that runs
entirely in the browser.

## Tech
- **Three.js** for the scan-line mesh + post-processing.
- **TypeScript + Vite** for a static, no-server build.
- Custom GLSL shaders for displacement, color, and CRT effects.
- **Web MIDI**, **Web Audio FFT**, and a small Node.js OSC ⇄ WebSocket bridge.

## Credits
Original Rutt/Etra hardware design: **Steve Rutt** & **Bill Etra**, 1973–1974.
Web build: 2025–2026. PRs welcome.
`;

// =====================================================================
// Auto-generated Controls reference
// =====================================================================

export function generateControlsMarkdown(filter?: string): string {
  const groups = new Map<PanelGroup, [string, ParamDoc][]>();
  const allKeys = Object.keys(DEFAULTS);
  const documented = new Set(Object.keys(PARAM_DOCS));

  const q = (filter || '').toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const matches = (key: string, doc: ParamDoc) => {
    if (tokens.length === 0) return true;
    const haystack = `${key} ${doc.description} ${doc.panel}`.toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  };

  for (const [k, doc] of Object.entries(PARAM_DOCS)) {
    if (!matches(k, doc)) continue;
    const arr = groups.get(doc.panel) ?? [];
    arr.push([k, doc]);
    groups.set(doc.panel, arr);
  }

  const order: PanelGroup[] = [
    'Source', 'DCU', 'Color/PostFX', 'Geometry', 'Camera',
    'Modulation', 'MIDI', 'Audio', 'OSC', 'Record', 'UI',
  ];

  let out = '# Controls\n\n';
  if (q) out += `Filtering by **"${filter}"**.\n\n`;
  let any = false;
  for (const g of order) {
    const items = groups.get(g);
    if (!items || items.length === 0) continue;
    any = true;
    out += `## ${g === 'Camera' ? 'Virtual Camera' : g}\n\n`;
    out += `| Key | Description | Range |\n|---|---|---|\n`;
    for (const [k, d] of items) {
      out += `| \`${k}\` | ${d.description} | ${d.range ?? ''} |\n`;
    }
    out += '\n';

    // Camera section gets a small button & gesture reference appended —
    // these aren't param keys but matter for the user.
    if (g === 'Camera' && cameraButtonsMatch(tokens)) {
      out += '### Virtual Camera — mode\n\n';
      out += 'Switch modes from **Virtual Camera panel → Mode** (top of the panel).\n\n';
      out += '**Orbit (default)** — drag to rotate, scroll to zoom, right-drag to pan.\n\n';
      out += '**Fly** — click the canvas to capture the pointer, then use the controls below. Click again or press `Esc` to release.\n\n';
      out += '| Fly key | Action |\n|---|---|\n';
      out += '| `W / S` | Forward / back |\n';
      out += '| `A / D` | Strafe left / right |\n';
      out += '| `Q / E` | Move down / up |\n';
      out += '| `Shift` | Sprint (3× speed) |\n';
      out += '| `Space` | Boost (10× speed) |\n';
      out += '| Mouse move | Aim (pointer locked) |\n\n';
      out += '### Camera buttons & gestures\n\n';
      out += '| Action | What |\n|---|---|\n';
      out += '| **Reset View** [R] | Snaps to your saved default view. |\n';
      out += '| **Save Default View** | Captures the current camera as the new saved default. |\n';
      out += '| **Reset Up** | Snaps the up-vector back to +Y without changing position. Use after orbiting through the poles. |\n';
      out += '| **Hard Reset Camera** [Shift+R] | Resets camera to factory defaults and clears your saved default view. Use this if the camera gets stuck or behaves unexpectedly. |\n';
      out += '| Drag | Orbit around the target — fully unconstrained, including over the top, behind, and inverted. |\n';
      out += '| Right-drag | Pan |\n';
      out += '| Scroll | Zoom |\n';
      out += '| Double-tap (mobile) | Reset View |\n';
      out += '| Long-press (mobile) | Peek mode — temporarily hides UI |\n\n';
    }
  }

  // Auto-generated graph-node reference. Sourced from `NODE_DEFS` so
  // adding a node type to the engine automatically lands here.
  const nodes = generateNodeReferenceMarkdown(tokens);
  if (nodes) {
    any = true;
    out += nodes;
  }

  if (!any) out += '_No matches._\n';

  // Dev-only: list undocumented keys.
  // eslint-disable-next-line no-undef
  const isDev = typeof import.meta !== 'undefined' && (import.meta as ImportMeta).env?.DEV;
  if (isDev) {
    const missing = allKeys.filter((k) => !documented.has(k) && !INTERNAL_KEYS.has(k as keyof Settings));
    if (missing.length) {
      out += '\n## TODO\n\n';
      out += '_Settings keys without documentation:_\n\n';
      for (const k of missing) out += `- \`${k}\`\n`;
    }
  }
  return out;
}

/**
 * The camera buttons block is gated on the same search filter so a query
 * for "reset view" or "hard reset" still surfaces it.
 */
function cameraButtonsMatch(tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = 'reset view save default hard reset camera up shift+r r drag pan zoom orbit fly peek mobile';
  return tokens.every((t) => hay.includes(t));
}

/**
 * Pull every registered node type out of the graph registry and emit a
 * markdown table per category. Filter tokens (already lowercased) match
 * against the node label, type, description, and category so the search
 * box in the Controls tab finds graph nodes too.
 *
 * The registry is statically imported — the help section itself is
 * lazy-loaded by `HelpSection`, so this just lands the registry in the
 * help chunk rather than the main bundle.
 */
function generateNodeReferenceMarkdown(tokens: string[]): string {
  const defs = allDefs();
  if (defs.length === 0) return '';
  const matches = (text: string): boolean => {
    if (tokens.length === 0) return true;
    const hay = text.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  };

  const byCat = new Map<string, typeof defs>();
  for (const d of defs) {
    const text = `${d.type} ${d.label} ${d.category} ${d.description}`;
    if (!matches(text)) continue;
    const list = byCat.get(d.category) ?? [];
    list.push(d);
    byCat.set(d.category, list);
  }
  if (byCat.size === 0) return '';

  let out = '## Modulation Graph Nodes\n\n';
  const order = ['Sources', 'Audio', 'Video', 'Inputs', 'Processors', 'Logic'];
  for (const cat of order) {
    const list = byCat.get(cat);
    if (!list?.length) continue;
    out += `### ${cat}\n\n`;
    out += '| Type | Description | Inputs | Outputs | Params |\n|---|---|---|---|---|\n';
    list.sort((a, b) => a.label.localeCompare(b.label));
    for (const d of list) {
      const ins = d.inputs.map((p) => p.name).join(', ') || '—';
      const outs = d.outputs.map((p) => p.name).join(', ') || '—';
      const params = Object.keys(d.params).join(', ') || '—';
      out += `| \`${d.type}\` | ${d.description} | ${ins} | ${outs} | ${params} |\n`;
    }
    out += '\n';
  }
  return out;
}

const INTERNAL_KEYS = new Set<keyof Settings>([
  'panelDock', 'panelCollapsed', 'panelTab', 'hudVisible',
  'helpSeen', 'helpAutoOpen', 'helpActiveTab',
  'activeTimelineId',
  'deviceId', 'requestedWidth', 'requestedHeight', 'requestedFps',
]);

// =====================================================================
// Video Audio
// =====================================================================

const MD_VIDEO_AUDIO = `
# Video Audio

The synth is silent by default. When a **video file** or **stream URL** source
is active you can optionally pass its audio track through to your system
speakers using the **Video Audio** group in the Video Source A panel.

## Controls

| Control | Description |
|---------|-------------|
| **Enable** | Unmutes the video element. Disabled again on every page load — you must re-enable each session intentionally. |
| **Volume** | 0 – 100 % output level. Adjustable while playing. |

## Notes

- Audio is **not** passed through for webcam or screen-capture sources; their
  mic/system audio is handled by the browser's own MediaStream API and the
  **Audio** section.
- The "disabled on page load" rule exists to prevent surprise audio playback
  after saving a preset or refreshing the page (Principle 4 of the design
  principles — the synth doesn't make sound by accident).
- If your video has no audio track the toggle has no effect; no error is shown.
- Enabling audio counts as a user gesture in all supported browsers, so browser
  autoplay restrictions are satisfied automatically.
`;

// =====================================================================
// Stream URL
// =====================================================================

const MD_STREAM = `
# Stream URL

Connect to a live video stream or remote video file directly from the
Source section. No plugins, virtual cameras, or browser extensions
needed — the stream plays inside the existing video element and feeds
the synth's scanline mesh exactly like a webcam or file source.

## Supported formats

| Format | Extension | Notes |
|--------|-----------|-------|
| HLS    | \`.m3u8\` | Works in all modern browsers. Safari uses native playback; Chrome / Firefox / Edge use hls.js (loaded on demand). |
| Direct video | \`.mp4\`, \`.webm\`, \`.mov\` | Any URL the browser can play as a \`<video src>\`. |
| RTSP relay | — | RTSP is a native protocol; browsers can't connect directly. Run a relay (e.g. \`ffmpeg\` → HLS, or MediaMTX with WebRTC output). See below. |
| MPEG-DASH | \`.mpd\` | Not supported. Re-mux to HLS with \`ffmpeg -i in.mpd -c copy out.m3u8\`. |

## How to connect

1. Open **Video Source A → Stream URL**.
2. Paste a URL and click **Use Stream**.
3. A "Connecting…" status appears while the stream loads. Errors are
   displayed inline — no silent failures.

The URL is saved across sessions so you don't need to re-paste it
after a page refresh. The stream does **not** auto-reconnect on load —
click "Use Stream" again to reconnect.

## Professional software (Millumin, Resolume, TouchDesigner, etc.)

These applications can't send video directly to a browser. Bridge options:

**OBS Studio (free, cross-platform)** — set OBS as a virtual camera
output from the software, then pick it under **Webcam** in the synth.
Works on macOS and Windows.

**NDI (macOS / Windows)** — many applications output NDI. Install
*NDI Tools* or *NDI Virtual Input* (free from ndi.tv) to expose the
NDI source as a virtual webcam. Appears as a regular webcam in the
synth's device list.

**Syphon → virtual camera (macOS only)** — applications with Syphon
output can feed into *Syphon Virtual Camera* (free), which then
appears as a webcam in Chrome.

**HLS relay (any OS)** — if the software can send an RTMP or RTSP
stream, run a minimal relay:
\`\`\`
# ffmpeg: RTMP in → HLS segments on localhost
ffmpeg -i rtmp://localhost:1935/live/stream \\
  -c copy -f hls -hls_time 1 -hls_list_size 3 \\
  /tmp/stream/index.m3u8
# Then serve that folder over HTTP and paste the URL here.
\`\`\`

## RTSP / RTMP from cameras or encoders

Browsers cannot connect to RTSP or RTMP natively. Recommended relay
options:

- **MediaMTX** (formerly rtsp-simple-server, free) — accepts RTSP/RTMP
  and re-streams as HLS. Paste the \`.m3u8\` URL into Stream URL.
- **ffmpeg** — see the HLS relay snippet above.
- **Node-RED** with \`node-red-contrib-rtsp-client\` — if you're
  already running a Node-RED automation server.

## Latency

HLS buffering adds 2–10 s of latency depending on segment length.
For low-latency monitoring, use **Screen Capture** (browser tab) or
a WebRTC relay (not currently built-in). HLS is best for pre-recorded
streams, broadcast feeds, and IP camera setups where a few seconds
of latency is acceptable.

## CORS

The stream server must allow \`Access-Control-Allow-Origin: *\` (or
your page's origin). Streams that block cross-origin requests will
fail with a network error in the status readout. If you control the
server, add the header; if not, a relay (see above) that you control
is the workaround.

---

# Output streaming — WHIP

Send the synth's canvas as a live stream to external servers and
software. Open **Share → WHIP Output**, paste an endpoint URL, and
click **Start WHIP**. The server receives the canvas as a WebRTC
stream and re-distributes it as HLS, RTMP, or WebRTC — whatever it
supports.

## What is WHIP?

WHIP (WebRTC HTTP Ingestion Protocol) is a simple standard for browsers
to push a WebRTC stream to a server with one HTTP request. It's the
*send* counterpart to HLS's *receive* role. OBS, MediaMTX, Cloudflare
Stream, and LiveKit all support it.

## Compatible servers

| Server | How to get a WHIP endpoint | Notes |
|--------|---------------------------|-------|
| **OBS 30+** | Tools → WHIP Server → Start | Listens on \`http://localhost:8080/whip\` by default. No token needed. |
| **MediaMTX** | Add a path in \`mediamtx.yml\`; endpoint is \`http://localhost:8889/whip/<name>\` | Free, self-hosted; also produces HLS, RTMP, RTSP output from the same path. |
| **Cloudflare Stream** | Streaming → WHIP endpoint; requires Bearer token (API token from Cloudflare dashboard) | Cloud-hosted; streams to Cloudflare CDN automatically. |
| **LiveKit Cloud** | Room settings → WHIP ingress; requires Bearer token | Cloud-hosted; distributes to LiveKit rooms and HLS. |
| **Janus WebRTC** | janus-gateway WHIP plugin | Self-hosted; flexible routing. |

## How to use with OBS

1. In OBS: **Tools → WHIP Server → Start WHIP Server** (OBS 30.0+).
2. OBS shows the endpoint URL (default: \`http://localhost:8080/whip\`).
3. In the synth: **Share → WHIP Output → Endpoint**. Paste the URL.
4. Click **Start WHIP**. OBS shows "connected" in its WHIP server panel.
5. In OBS, add a **Media Source** or use OBS to re-stream to Twitch,
   YouTube, or record locally.

## How to use with MediaMTX (local relay, any platform)

MediaMTX converts between WHIP, HLS, RTMP, RTSP, and WebRTC — useful
for getting the synth into OBS without OBS's built-in WHIP server.

\`\`\`
# Install: https://github.com/bluenviron/mediamtx/releases
# Run with defaults — WHIP path is available immediately:
./mediamtx

# In the synth: Share → WHIP Output → Endpoint
# Paste: http://localhost:8889/whip/synth
# Start WHIP.

# MediaMTX outputs at:
#   HLS:    http://localhost:8888/synth
#   RTMP:   rtmp://localhost:1935/synth
#   RTSP:   rtsp://localhost:8554/synth
#   WebRTC: http://localhost:8889/synth   (web player)
\`\`\`

## Bearer token (for cloud servers)

Cloudflare Stream and LiveKit require an API token in the **Token** field.
Copy the token from your cloud dashboard. It is stored locally in your
browser settings and never included in preset exports.

## Peer-to-peer broadcast

**Share → P2P Broadcast** is a separate, simpler option: the synth
generates a one-time share URL. Anyone who opens that URL sees the live
canvas in their browser — no server required. Use this for quick sharing;
use WHIP for integration with production tools, recording, or CDN delivery.
`;

// =====================================================================
// Tabs
// =====================================================================

export const HELP_TABS: HelpTab[] = [
  { id: 'what',       label: 'What is this?',  markdown: MD_WHAT },
  { id: 'quickstart', label: 'Quick start',    markdown: MD_QUICKSTART },
  { id: 'controls',   label: 'Controls',       markdown: () => generateControlsMarkdown() },
  { id: 'shortcuts',  label: 'Shortcuts',      markdown: MD_SHORTCUTS },
  { id: 'mod',        label: 'Modulation',     markdown: MD_MOD },
  { id: 'timeline',   label: 'Timeline',       markdown: MD_TIMELINE },
  { id: 'project',    label: 'Project',        markdown: MD_PROJECT },
  { id: 'xr',         label: 'WebXR',          markdown: MD_XR },
  { id: 'anaglyph',   label: 'Anaglyph 3D',   markdown: MD_ANAGLYPH },
  { id: 'stereo',     label: '3D Recording',   markdown: MD_STEREO },
  { id: 'video-audio', label: 'Video Audio',   markdown: MD_VIDEO_AUDIO },
  { id: 'stream',     label: 'Streaming',      markdown: MD_STREAM },
  { id: 'tips',       label: 'Tips & gotchas', markdown: MD_TIPS },
  { id: 'about',      label: 'About',          markdown: MD_ABOUT },
];
