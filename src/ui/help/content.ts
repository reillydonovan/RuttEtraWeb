/**
 * Help/manual content. Each tab is a markdown string (or function returning
 * one for dynamically generated content).
 *
 * Voice: short sentences, concrete examples, no jargon without parenthetical.
 */

import { DEFAULTS, Settings } from '../../state/Settings';
import '../../modulation/graph/bootstrap';
import { allDefs } from '../../modulation/graph/registry';

export type PanelGroup =
  | 'Source' | 'DCU' | 'Color/PostFX' | 'Geometry' | 'Camera'
  | 'Modulation' | 'MIDI' | 'Audio' | 'OSC' | 'Record' | 'Share' | 'UI';

export interface ParamDoc {
  description: string;
  range?: string;
  panel: PanelGroup;
}

export interface HelpTab {
  id: string;
  label: string;
  markdown: string | (() => string);
}

// =====================================================================
// Per-parameter docs (shown on the Controls tab).
// =====================================================================

export const PARAM_DOCS: Record<string, ParamDoc> = {
  // ----- Source -----
  sourceKind: { description: 'Active video source: webcam, screen share, or file.', panel: 'Source' },
  mirrorH:    { description: 'Mirror the input left/right.', panel: 'Source' },
  mirrorV:    { description: 'Mirror the input top/bottom (default ON to match Rutt/Etra orientation).', panel: 'Source' },

  // ----- DCU (Display Control Unit) -----
  zPush:      { description: 'How far bright pixels are pushed toward the camera.', range: '-4..4', panel: 'DCU' },
  zBias:      { description: 'Vertical offset added to every scanline before pushing in Z.', range: '-2..2', panel: 'DCU' },
  zInvert:    { description: 'Invert the brightness-to-Z mapping (dark pushes forward).', panel: 'DCU' },
  intensity:  { description: 'Brightness multiplier applied to each scanline.', range: '0..3', panel: 'DCU' },
  focus:      { description: 'Soft Gaussian blur on the brightness signal.', range: '0..1', panel: 'DCU' },
  threshold:  { description: 'Black-crush threshold; pixels below this go to 0.', range: '0..1', panel: 'DCU' },
  contrast:   { description: 'Contrast applied before scanning.', range: '0..3', panel: 'DCU' },
  gamma:      { description: 'Gamma correction (lower = brighter midtones).', range: '0.2..3', panel: 'DCU' },
  hPos:       { description: 'Horizontal centering of the raster.', panel: 'DCU' },
  vPos:       { description: 'Vertical centering of the raster.', panel: 'DCU' },
  hSize:      { description: 'Horizontal stretch of the raster.', panel: 'DCU' },
  vSize:      { description: 'Vertical stretch of the raster.', panel: 'DCU' },
  hLinearity: { description: 'Pinch/expand the raster horizontally (non-linear stretch).', panel: 'DCU' },
  vLinearity: { description: 'Pinch/expand the raster vertically (non-linear stretch).', panel: 'DCU' },
  scanRate:   { description: 'Number of horizontal scanlines drawn per frame.', range: '60..720', panel: 'DCU' },
  cols:       { description: 'Samples per scanline (horizontal resolution).', range: '32..960', panel: 'DCU' },
  skip:       { description: 'Skip every N-th scanline to thin the pattern.', panel: 'DCU' },
  hSpin:      { description: 'Horizontal twist (yaw) of the rendered surface.', panel: 'DCU' },
  vSpin:      { description: 'Vertical twist (pitch).', panel: 'DCU' },
  hSpinRate:  { description: 'Auto-rotate around the Y axis at this rate.', panel: 'DCU' },
  vSpinRate:  { description: 'Auto-rotate around the X axis at this rate.', panel: 'DCU' },
  hReverse:   { description: 'Flip horizontal scan direction.', panel: 'DCU' },
  vReverse:   { description: 'Flip vertical scan direction.', panel: 'DCU' },
  rotate90:   { description: 'Rotate the entire raster 90°.', panel: 'DCU' },

  // ----- Color / PostFX -----
  colorMode:        { description: 'Phosphor look: grayscale, green, amber, custom tint, or sampled video color.', panel: 'Color/PostFX' },
  customTint:       { description: 'Tint applied when colorMode is "phosphorCustom".', panel: 'Color/PostFX' },
  backgroundColor:  { description: 'Backdrop color behind the scanlines.', panel: 'Color/PostFX' },
  bloomEnabled:     { description: 'CRT bloom (off by default for crisp lines).', panel: 'Color/PostFX' },
  bloomIntensity:   { description: 'Bloom strength.', panel: 'Color/PostFX' },
  bloomRadius:      { description: 'Bloom blur radius.', panel: 'Color/PostFX' },
  bloomThreshold:   { description: 'Pixel brightness threshold above which bloom kicks in.', panel: 'Color/PostFX' },
  scanlineEnabled:  { description: 'Overlay horizontal scanline mask.', panel: 'Color/PostFX' },
  scanlineIntensity:{ description: 'How dark the gaps between scanlines get.', panel: 'Color/PostFX' },
  scanlineDensity:  { description: 'Scanlines per screen height.', panel: 'Color/PostFX' },
  chromaEnabled:    { description: 'Subtle chromatic aberration on the RGB channels.', panel: 'Color/PostFX' },
  chromaAmount:     { description: 'Strength of the chromatic offset.', panel: 'Color/PostFX' },
  vignetteEnabled:  { description: 'Soft corner darkening.', panel: 'Color/PostFX' },
  vignetteAmount:   { description: 'Vignette strength.', panel: 'Color/PostFX' },
  feedbackEnabled:  { description: 'Long-exposure feedback trails (CRT burn-in).', panel: 'Color/PostFX' },
  feedbackDecay:    { description: 'How fast trails fade (1 = forever, 0 = none).', range: '0..1', panel: 'Color/PostFX' },

  // ----- Geometry / render -----
  renderMode:       { description: 'Wireframe (lines) vs filled triangles vs points.', panel: 'Geometry' },
  thickLines:       { description: 'Use a thicker line technique (heavier on GPU).', panel: 'Geometry' },
  lineWidth:        { description: 'Line thickness when thickLines is on.', panel: 'Geometry' },

  // ----- Camera -----
  cameraMode:       { description: 'Orbit (mouse drag, quaternion-based — full 360° in any axis) or fly-through (WASD + mouse, unclamped pitch/roll).', panel: 'Camera' },
  cameraFov:        { description: 'Field of view in degrees.', range: '20..120', panel: 'Camera' },
  cameraNear:       { description: 'Near clipping plane.', panel: 'Camera' },
  cameraFar:        { description: 'Far clipping plane.', panel: 'Camera' },
  autoOrbit:        { description: 'Slowly orbit the scene with no input.', panel: 'Camera' },
  autoOrbitSpeed:   { description: 'Orbit angular speed.', panel: 'Camera' },
  flySpeed:         { description: 'Base movement speed in fly mode.', panel: 'Camera' },
  flyBoost:         { description: 'Hold Shift to multiply fly speed by this.', panel: 'Camera' },
  defaultView:      { description: 'Saved camera view used by the "Reset View [R]" button. Cleared by "Hard Reset Camera [Shift+R]".', panel: 'Camera' },

  // ----- Modulation -----
  modSlots: { description: 'Up to 8 modulation slots. Each routes a signal source to a parameter.', panel: 'Modulation' },

  // ----- MIDI -----
  midiInputId:    { description: 'Selected MIDI input device.', panel: 'MIDI' },
  midiOutputId:   { description: 'Selected MIDI output device (for slot CC echo).', panel: 'MIDI' },
  midiBindings:   { description: 'CC/note bindings that map MIDI messages to settings.', panel: 'MIDI' },

  // ----- OSC -----
  oscBridgeUrl:   { description: 'WebSocket URL of the local osc-bridge process.', panel: 'OSC' },
  oscAutoConnect: { description: 'Reconnect automatically when the bridge restarts.', panel: 'OSC' },
  oscBindings:    { description: 'OSC address → settings target bindings.', panel: 'OSC' },

  // ----- Audio -----
  audioInputKind:    { description: 'Audio source: microphone, audio file, or browser tab capture.', panel: 'Audio' },
  audioFftSize:      { description: 'FFT window size. Larger = finer frequency resolution.', panel: 'Audio' },
  audioBandCount:    { description: 'How many bands to derive from the spectrum.', panel: 'Audio' },
  audioBandSpacing:  { description: 'Band layout: linear, log, or mel.', panel: 'Audio' },
  audioAttackMs:     { description: 'Per-band rise time (ms).', panel: 'Audio' },
  audioReleaseMs:    { description: 'Per-band fall time (ms).', panel: 'Audio' },
  audioGain:         { description: 'Master gain on band values.', panel: 'Audio' },
  audioFloor:        { description: 'Cutoff: anything below this clamps to 0.', panel: 'Audio' },
  audioThresholdDb:  { description: 'Analyser dB floor (lower = more sensitive).', panel: 'Audio' },
  audioMonitor:      { description: 'Route input audio back to the speakers.', panel: 'Audio' },
  audioSpectrum:     { description: 'Spectrum-driven Z displacement on each scanline.', panel: 'Audio' },
  beatEnabled:       { description: 'Spectral-flux beat detector.', panel: 'Audio' },
  beatSensitivity:   { description: 'Sensitivity multiplier on the adaptive threshold.', panel: 'Audio' },
  spectrumAmount:    { description: 'Strength of the spectrum-driven Z displacement.', panel: 'Audio' },
  spectrumStride:    { description: 'How many bands per scanline (1 = one band per row).', panel: 'Audio' },

  // ----- Record -----
  recordPreferredFormat: { description: 'Preferred container/codec for recordings.', panel: 'Record' },
  recordFps:             { description: 'Capture frame rate.', panel: 'Record' },
  recordBitrateMbps:     { description: 'Video bitrate (Mbps).', panel: 'Record' },
  recordIncludeMic:      { description: 'Mix the microphone into the recording.', panel: 'Record' },

  // ----- UI -----
  panelDock:        { description: 'Side panel docks to the left or right edge.', panel: 'UI' },
  panelCollapsed:   { description: 'Side panel collapsed state.', panel: 'UI' },
  panelTab:         { description: 'Active top-level panel tab.', panel: 'UI' },
  hudVisible:       { description: 'Show on-screen FPS/source HUD.', panel: 'UI' },
  helpAutoOpen:     { description: 'Auto-open this manual on first run.', panel: 'UI' },
  timelineDock:     { description: 'Position of the timeline dock: top, bottom, or hidden.', panel: 'UI' },
  timelineHeight:   { description: 'Pixel height of the timeline dock.', panel: 'UI' },
};

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
  audio band, beat pulse, MIDI CC, MIDI note, MIDI clock division, OSC, joystick.
- Tick **Sync** on a waveform slot to lock its rate to the MIDI clock.
- Example: slot 1 → source **beat**, target **zPush**, amount **0.6**, then
  open the **Audio** panel, pick **mic**, and tap a kick. Relief jumps on every
  hit.

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
