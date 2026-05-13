/**
 * Help/manual content. Each tab is a markdown string (or function returning
 * one for dynamically generated content).
 *
 * Voice: short sentences, concrete examples, no jargon without parenthetical.
 */

import { DEFAULTS, Settings } from '../../state/Settings';

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
  cameraMode:       { description: 'Orbit (mouse drag) or fly-through (WASD + mouse).', panel: 'Camera' },
  cameraFov:        { description: 'Field of view in degrees.', range: '20..120', panel: 'Camera' },
  cameraNear:       { description: 'Near clipping plane.', panel: 'Camera' },
  cameraFar:        { description: 'Far clipping plane.', panel: 'Camera' },
  autoOrbit:        { description: 'Slowly orbit the scene with no input.', panel: 'Camera' },
  autoOrbitSpeed:   { description: 'Orbit angular speed.', panel: 'Camera' },
  flySpeed:         { description: 'Base movement speed in fly mode.', panel: 'Camera' },
  flyBoost:         { description: 'Hold Shift to multiply fly speed by this.', panel: 'Camera' },
  defaultView:      { description: 'Saved camera view used by the "Reset View" button.', panel: 'Camera' },

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
| \`R\` | Reset camera view |
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
# Modulation

The **Modulation** panel has up to 8 slots. Each slot routes a *source* signal
to a *target* parameter and scales it by **amount**.

## Sources
- **Waveforms** — sine / triangle / square / saw / pulse / ramp.
- **Audio envelope** — overall input loudness.
- **Audio band** — pick a single FFT band.
- **Beat** — decaying pulse on each detected beat.
- **MIDI** — CC value, last note, velocity, or clock phase.
- **OSC** — last value received on a bound OSC address.
- **Joystick** — gamepad axis (when connected).

## Sync to clock
Tick **Sync** on a waveform slot to lock its rate to the MIDI clock at a chosen
division (1/4, 1/8, ..., dotted, triplets). Without an incoming clock the
internal BPM is used.

## Example: kick-driven Z push
1. Mod slot 1 → source **beat**, target **zPush**, amount **0.6**.
2. Audio panel → input **mic**, beat detection on.
3. Tap a kick. Watch the relief map jump on every hit.
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
