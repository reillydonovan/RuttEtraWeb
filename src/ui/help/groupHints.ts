/**
 * One-paragraph summaries for the SUB-GROUPS inside a Controls section
 * (the headed blocks like "Capture Settings", "Webcam", "Pattern Generator"),
 * shown by each group's ⓘ button. Parameter rows come from `PARAM_DOCS` (the
 * `[data-param-key]` controls inside the group, read when the button is
 * pressed), so this file only holds what has no other home: what the GROUP is
 * for. Pure data (principle 1 — one place for this text).
 *
 * Keys are the group title; a title used in more than one section is keyed
 * `Section › Group` (looked up first). A group with no entry still gets an ⓘ
 * with its parameter list.
 */

export const GROUP_HINTS: Record<string, string> = {
  // ── Video Source A / B ──────────────────────────────────────────────
  'Capture Settings': 'How the webcam is opened: resolution and frame rate. With a camera running, changing either restarts it at once and reports the size the camera actually gave you — a camera may offer less than you ask for.',
  'Webcam': 'Pick a camera and start it. Use Refresh to re-list devices (the browser only shows camera names after you have granted permission once).',
  'Screen Capture': 'Use a screen, window or browser tab as the picture. The browser asks what to share each time. Not available on phones.',
  'Video File': 'Play a video file from your computer as the picture. It loops. Color mode switches to Video so the scan lines take the clip\'s own colors.',
  'Stream URL': 'Play a live or hosted stream: HLS (.m3u8) or a direct MP4/WebM link. The URL is remembered but never reconnected automatically.',
  'Video Audio': 'Play the sound of a video file or stream through your speakers. Off on every page load — check your volume before turning it on.',
  'Mirror': 'Flip the picture horizontally and/or vertically before it reaches the raster.',
  'Pattern Generator': 'A built-in picture source that needs no camera: sixteen patterns and an oscilloscope. It is a layer over the video, blended with Replace, Add, Screen and more — or the whole picture when there is no video. The parameters below change with the kind you pick.',

  // ── Display Control Unit ────────────────────────────────────────────
  'Position & Size': 'Where the raster sits on screen and how big it is. Aspect sets its shape (4:3 is the hardware default; DCU ▸ Match source fits the input).',
  'Depth (Z) — Brightness Displacement': 'The heart of a scan processor: brightness pushes each scan line toward the camera. Z Push is how far; Z Bias shifts the whole sheet nearer or farther.',
  'Beam': 'The electron beam: Intensity is how bright the lines are, Focus how sharp or soft.',
  'Rotation': 'Rotate the raster around its center point, or spin it continuously. H and V Center move the pivot.',
  'Scan': 'How the picture is sampled into lines. Skip drops scan lines; fewer, thicker lines read more like the original hardware.',
  'Linearity': 'Bends the raster the way a drifting analog deflection circuit would: horizontal and vertical linearity warp the lines.',
  'Luminance Shaping': 'Shapes brightness before it becomes depth: a threshold to ignore dark noise, contrast to stretch it, and gamma to bend the curve.',

  // ── Dual Raster ─────────────────────────────────────────────────────
  'Dual Trace': 'A second, independent raster drawn alongside the first. Choose how the two share the screen: a wipe, or alternating lines. Wire a picture for raster B in the Patch Bay.',
  'B · Position & Size': 'Raster B\'s own position and size.',
  'B · Depth & Beam': 'Raster B\'s own depth, bias and beam intensity.',
  'B · Rotation': 'Raster B\'s own rotation and spin.',
  'B · Luminance Shaping': 'Raster B\'s own threshold, contrast and gamma.',

  // ── Virtual Camera ──────────────────────────────────────────────────
  'Mode': 'Orbit moves the camera around the scene with the mouse or touch; Fly lets you move through it with the keyboard.',
  'Lens': 'The camera lens: field of view and the near and far clipping distances.',
  'Auto-orbit': 'Slowly circle the camera around the raster on its own.',
  'Fly settings': 'Speed and boost for fly mode.',
  'Anaglyph 3D': 'Red-cyan 3D for glasses: renders two eyes and tints them. IPD is the eye separation.',
  'Resolution': 'The size of the rendered picture and how it fits the window. Fixed sizes are useful for recording and for a projector.',

  // ── Color / Post FX ─────────────────────────────────────────────────
  'Color': 'How the scan lines are colored: a phosphor tint, the video\'s own colors, or a custom tint, over a background color.',
  'Bloom (Phosphor Glow)': 'The glow around bright lines. Intensity, radius and the brightness threshold where it starts.',
  'Burn-In Feedback': 'Trails: each frame fades into the next, like slow phosphor. Decay sets how long, and the shape controls how the trail drifts.',
  'Analog Character': 'Small analog imperfections — noise, drop-outs, hum — for a less perfect, more physical picture.',
  'Chromatic Aberration': 'Splits the red, green and blue slightly apart toward the edges, like a cheap lens.',
  'Scanline Overlay': 'Darkens every other row, like a CRT\'s visible lines. Density sets how many lines fit.',
  'Vignette': 'Darkens the corners of the picture.',

  // ── Modulation ──────────────────────────────────────────────────────
  'All slots': 'Settings shared by every Classic modulation slot.',
  'Tempo': 'The one tempo the whole synth shares: Classic LFOs, the Timeline and graph clocks all follow it. Set it here or let MIDI clock drive it.',
  'Joystick (XY pad + Z)': 'A touch pad and slider you can use as three modulation sources (X, Y, Z) — useful with a phone or touchscreen.',
  'Audio Interface (mic)': 'Use a microphone or audio interface as a modulation source.',

  // ── Audio ───────────────────────────────────────────────────────────
  'Input': 'Where the sound comes from: the microphone or an audio input. Permission is asked when you pick it.',
  'FFT': 'How the sound is analyzed into frequency bands: the transform size, how many bands, and how they are spaced.',
  'Bands': 'A live picture of the frequency bands. Each band can drive a parameter.',
  'Beat detector': 'Finds the beat in the sound and fires a pulse on it, which can drive any parameter.',
  'Spectrum -> Z displacement': 'Lets the sound spectrum push the raster in depth directly, with no patching.',
  'Monitor': 'Hear the input through your speakers. Off by default, because a microphone near speakers can feed back.',

  // ── MIDI ────────────────────────────────────────────────────────────
  'Devices': 'The MIDI devices the browser can see. Connect one to map its controls.',
  'MIDI › Bindings': 'Which MIDI control moves which parameter, with a range and curve for each. Use Learn to bind a control by moving it.',
  'Clock': 'MIDI clock in and out: follow another device\'s tempo, or send yours.',

  // ── OSC ─────────────────────────────────────────────────────────────
  'Bridge': 'The address of the OSC bridge program that carries OSC between your network and the browser.',
  'OSC › Bindings': 'Which OSC address moves which parameter. Use Learn to bind an address by sending it.',

  // ── CV ──────────────────────────────────────────────────────────────
  'CV Inputs (audio interface)': 'Control-voltage inputs read through a DC-coupled audio interface.',
  'CV Inputs (OSC bridge)': 'Control-voltage values arriving as OSC from a small hardware bridge.',
  'Gamepad / HID': 'Use a gamepad or other HID controller as a modulation source.',
  'Other CV routes': 'Extra routes for control-voltage values.',
  'CV Outputs (audio interface)': 'Send modulation OUT as control voltage through a DC-coupled audio interface. Off until you arm it, with a soft start and a limiter.',

  // ── Sonification ────────────────────────────────────────────────────
  'Sonification (audible voice)': 'Turns the picture into sound: a synth voice driven by what is on screen. Off by default, quiet when on, and limited.',
  'Voice': 'The voice itself: waveform, pitch range and level.',
  'Mapping': 'Which measurements of the picture (or a graph node) drive which parts of the voice.',

  // ── Geometry / Performance ──────────────────────────────────────────
  'Render Mode': 'How the raster is drawn: lines, dots or wireframe.',
  'Performance Profile': 'Quality presets that trade detail for speed on slower machines.',
  'Render Scale': 'Render at a lower internal resolution and scale up: faster, softer.',
  'Performance › Device': 'What the browser reports about your graphics and display.',

  // ── Presets / Project ───────────────────────────────────────────────
  'Built-in Presets': 'Ready-made looks. A preset changes only the settings it names — your patches, bindings and layout are untouched.',
  'User Presets': 'Your own saved looks, kept in this browser.',
  'Save / Load Settings': 'Save the current settings to this browser, or load them back.',
  'Import / Export': 'Move settings to and from a file.',
  'Backup & Restore': 'Back up everything this browser has saved for the app, and restore it.',
  'Danger Zone': 'Resets that cannot be undone. Export a backup first.',
  'Project': 'The current project: its name, saving and opening.',
  'Recent Projects': 'Projects you opened or saved recently.',
  'Auto-save': 'Keep a recovery copy while you work so a crash or closed tab can be recovered. Off by default.',

  // ── Record / Share / XR ─────────────────────────────────────────────
  'Record › Configuration': 'Frame rate, quality, format and whether to include the microphone for recordings.',
  'Record Timeline': 'Record the output while the Timeline plays through, so a whole score becomes one clip.',
  'Stereoscopic 3D': 'Record side-by-side stereo for 3D displays and headsets.',
  'Share › Configuration': 'Options for broadcasting to a link and QR code.',
  'WHIP Output': 'Stream to OBS, MediaMTX or Cloudflare over WHIP, for bigger audiences.',
  'XR › Configuration': 'Options for the WebXR headset session.',
  'XR › Device': 'The headset the browser found, and its status.',
  'XR': 'Enter a WebXR headset session.',

  // ── MCP ─────────────────────────────────────────────────────────────
  'MCP Bridge': 'Lets an AI assistant control the synth over MCP. Opt-in and local: it connects out to a bridge you run on this machine.',
};

/** The summary for a group, preferring a section-qualified entry. */
export function groupHint(section: string | null, title: string): string {
  return (section ? GROUP_HINTS[`${section} › ${title}`] : undefined) ?? GROUP_HINTS[title] ?? '';
}
