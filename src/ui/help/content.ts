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

1. Click **REQUEST WEBCAM**, or in the Source panel pick **Screen Share** or **Upload File**.
2. Drag with the mouse to orbit. Scroll to zoom. Press \`R\` to reset the view.
3. Try a preset: open the **Presets** panel and click any chip ( *Phosphor Green*, *Burn-In*, ... ).
4. Open the **MIDI** or **Audio** tab to add reactive control.
5. Open the timeline strip at the bottom, hit **+ NEW**, drop preset chips onto the track to create keyframes, then **PLAY**.

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

## When the timeline dock is hovered
| Key | What |
|-----|------|
| \`Space\` | Play / pause |
| \`←\` / \`→\` | Nudge playhead one beat |
| \`Shift+←\` / \`Shift+→\` | Nudge one bar |
| \`Home\` | Seek to bar 0 |
| \`K\` | Add keyframe at the playhead (snapshots current settings) |
| \`Delete\` | Remove the selected keyframe |
| \`Ctrl+Z\` / \`Ctrl+Shift+Z\` | Undo / redo |
| \`Alt+drag\` | Drag a keyframe without beat-snapping |
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

Open **Library** in the Graph view to load any of: Audio Ring Mod, Video
Brightness Tracking, Beat-Synced Step Sequencer, Motion-Triggered Glitch,
Slewed Pitch Follow, Reactive Crossfade, Edge-Driven Focus.
`;

const MD_TIMELINE = `
# Timeline / Scene Sequencer

A horizontal dock at the bottom of the screen. Each timeline holds **keyframes**
— snapshots of every parameter — and interpolates between them over time.

## Workflow
1. Click **+ NEW** in the transport.
2. Drag a preset chip from the Presets panel onto the track to drop a keyframe.
3. Drag the diamond markers to move keyframes. Hold \`Alt\` to disable beat-snap.
4. Click a diamond to edit its **easing**, lock state, or rename it in the inspector.
5. Hit **PLAY**.

## BPM and bars
Set BPM, beats-per-bar, and total length in the transport. Switch **SYNC** to
**MIDI** to follow incoming MIDI clock instead of the internal BPM.

## Recording a timeline
The **Record** panel has a **Record Timeline** button: it seeks to bar 0,
disables looping for one pass, plays the timeline, and downloads a video named
after the timeline when it reaches the end.

## Keyframe context menu
Right-click any diamond for: preview, **replace snapshot with current**,
duplicate, lock, change easing, or delete. Right-click empty track to add a
keyframe at that bar.

## Excluded parameters
Camera position, source kind, recording settings, and panel UI flags never
animate. Edit \`excludedParams\` on a timeline if you want a different list.
`;

const MD_TIPS = `
# Tips & gotchas

- **Webcam permission denied.** Click the address-bar lock icon and grant camera permission, then reload. Some browsers block webcam on \`http://\` — use \`https://\` or \`localhost\`.
- **Black screen but FPS is fine.** Check the **Source** panel; the active source might be paused. Try pressing **REQUEST WEBCAM** again.
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
- **Camera rotation is unconstrained** — you can orbit completely over the top, underneath, or behind the raster. If the world ends up rolled at an awkward angle, click **Reset Up** in the Camera panel (or use **Hard Reset Camera** / \`Shift+R\` to fully clear it back to factory defaults).
- **Camera got stuck or pointer-locked weird?** \`Shift+R\` is the escape hatch — it releases pointer lock, kills auto-orbit, switches back to Orbit mode, wipes any saved default, and snaps every value to factory defaults.
- **Set Resolution to Full HD or 4K before recording** for consistent output dimensions regardless of your browser window size. The recorded video will be exactly the selected resolution.
- **Render Scale is a multiplier on the chosen resolution.** 4K × 0.5 scale renders 1080p internally and upscales — fast performance recovery if your GPU is struggling, with no change to the recording dimension story.
- **Letterbox fit guarantees pixel-accurate recording.** Fill or Stretch can crop or distort the render when the window doesn't match the preset's aspect ratio. Use Letterbox for predictable recording output.
- **Custom resolution on mobile may be slow.** On compact/touch devices the Resolution dropdown caps selectable options at Full HD. Higher presets are still listed but grayed out.
- **There is one BPM.** The Tempo BPM at the top of the Modulation panel is shared by the Timeline, every Classic LFO in Tempo sync mode, and the Graph Clock node — change it once and it's reflected everywhere. The Timeline transport's BPM input is now just a window onto the same value.
- **MIDI sync without a clock holds at the last known rate.** If you select MIDI sync on a slot but never plug a clock in (or your DAW stops sending one), the slot doesn't silently fall back to the internal BPM. The **NO CLOCK** badge under the slot warns you. Switch to Tempo sync if you want it to follow the global BPM, or to Free for a fixed Hz.
- **One-shot ramps.** Turn the Ramp slot's **Loop** toggle off to make it run once and hold. Hit the slot's **Retrigger** button (or assign it via MIDI) whenever you want to fire the envelope again.
- **Use the slot's Output stage to fit a parameter's range.** Set Min / Max to clamp the swing, Offset to bias the result around a non-zero rest value, and the Curve dropdown to bend the response without baking the curve into the source itself — handy when re-routing the same LFO to several params with different feels.
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
    out += `## ${g}\n\n`;
    out += `| Key | Description | Range |\n|---|---|---|\n`;
    for (const [k, d] of items) {
      out += `| \`${k}\` | ${d.description} | ${d.range ?? ''} |\n`;
    }
    out += '\n';

    // Camera section gets a small button & gesture reference appended —
    // these aren't param keys but matter for the user.
    if (g === 'Camera' && cameraButtonsMatch(tokens)) {
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
// Tabs
// =====================================================================

export const HELP_TABS: HelpTab[] = [
  { id: 'what',       label: 'What is this?',  markdown: MD_WHAT },
  { id: 'quickstart', label: 'Quick start',    markdown: MD_QUICKSTART },
  { id: 'controls',   label: 'Controls',       markdown: () => generateControlsMarkdown() },
  { id: 'shortcuts',  label: 'Shortcuts',      markdown: MD_SHORTCUTS },
  { id: 'mod',        label: 'Modulation',     markdown: MD_MOD },
  { id: 'timeline',   label: 'Timeline',       markdown: MD_TIMELINE },
  { id: 'tips',       label: 'Tips & gotchas', markdown: MD_TIPS },
  { id: 'about',      label: 'About',          markdown: MD_ABOUT },
];
