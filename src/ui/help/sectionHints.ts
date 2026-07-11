/**
 * One-line hover descriptions for panel section headers ("DISPLAY
 * CONTROL UNIT", "Modulation", ...) — the coarse-grained sibling of
 * `PARAM_DOCS` (which covers individual params). Keyed by the exact
 * `title` string passed to `ControlPanel.addSection()`.
 *
 * Pure data, no dependencies — safe to import from any UI module.
 * A section with no entry here just gets no header tooltip; nothing
 * breaks.
 */
export const SECTION_HINTS: Record<string, string> = {
  Source: 'The video signal feeding the synth — webcam, screen capture, a file, or a stream URL — plus the Pattern Generator, a built-in synthesized signal.',
  'Display Control Unit': 'The core Rutt/Etra control set: how video maps onto the scanline mesh — position, size, depth (Z) displacement, beam focus/intensity, and rotation.',
  'Dual Raster': 'A second, independently modulated raster fed by the same video — wipe or interleave it against the main raster.',
  Camera: 'The free-flight 3D camera: orbit/fly modes, field of view, and the saved default view.',
  XR: 'WebXR headset output — view the scanline mesh in VR or AR.',
  'Color / Post FX': 'Color grading and the CRT post-processing chain: bloom, feedback/burn-in, scanlines, analog character.',
  Modulation: 'The two modulation engines — Classic (4-slot patch matrix) and Graph (node-based) — that drive parameters over time from LFOs, audio, MIDI, CV, and more.',
  Geometry: 'Mesh density and wireframe/solid rendering options for the scanline mesh itself.',
  Presets: 'Save, load, and manage full-settings snapshots ("looks") for instant recall.',
  Project: 'Save and load the entire workspace — settings, presets, and timelines — as a single project file.',
  Performance: 'Rendering quality/performance tradeoffs, set per layout mode (compact/standard/expansive).',
  Record: 'Capture the canvas output to a video file, including stereoscopic and WebXR recording.',
  Share: 'Broadcast the live output to a remote viewer over WebRTC, or publish to a WHIP-compatible streaming service.',
  MIDI: 'Connect a MIDI controller or clock source; map CCs to any modulatable parameter.',
  Audio: 'FFT frequency-band analysis and beat detection, usable as a modulation source.',
  OSC: 'Open Sound Control over WebSocket — send and receive parameter values from TouchOSC, Max, SuperCollider, etc.',
  CV: 'Control-voltage INPUT from a DC-coupled audio interface — drive any parameter with real analog voltage.',
  'CV Out': 'Control-voltage OUTPUT — send synth parameters, modulation, or graph signals to real analog hardware.',
  Sonification: "Turn the rendered mesh itself into an audio signal — a synth voice driven by what's on screen.",
};
