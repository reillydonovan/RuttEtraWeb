/**
 * Per-parameter documentation — pure data, no dependencies on the rest
 * of the help system, no markdown content, no graph imports.
 *
 * This file is the single source of truth for the in-app Help's
 * Controls tab and the about-page Param Reference section. It's split
 * out from `content.ts` so the about page can import only this map
 * (and tree-shake away the much heavier in-app Help markdown blobs).
 *
 * Adding a new param = add a key here. Both surfaces pick it up
 * automatically.
 */

export type PanelGroup =
  | 'Source' | 'Pattern' | 'DCU' | 'Color/PostFX' | 'Geometry' | 'Camera'
  | 'Modulation' | 'MIDI' | 'Audio' | 'OSC' | 'CV' | 'Record' | 'Share'
  | 'XR' | 'UI';

export interface ParamDoc {
  description: string;
  range?: string;
  panel: PanelGroup;
}

export const PARAM_DOCS: Record<string, ParamDoc> = {
  // ----- Source -----
  sourceKind:    { description: 'Active video source: webcam, screen share, file, or stream URL.', panel: 'Source' },
  requestedWidth:  { description: 'Requested webcam capture resolution. "Auto (native)" lets the browser pick the camera\'s own resolution. Applies on the next "Use Webcam" — changing it doesn\'t affect an already-running capture.', panel: 'Source' },
  requestedFps:    { description: 'Requested webcam capture frame rate. The camera/browser may substitute its nearest supported rate. Applies on the next "Use Webcam".', range: '1..120', panel: 'Source' },
  mirrorH:       { description: 'Mirror the input left/right.', panel: 'Source' },
  mirrorV:       { description: 'Mirror the input top/bottom (default ON to match Rutt/Etra orientation).', panel: 'Source' },
  streamUrl:        { description: 'Last URL used with "Use Stream". Accepts HLS (.m3u8), MPEG-DASH (.mpd), or any direct video URL the browser can play. Not auto-connected on load — click "Use Stream" to reconnect.', panel: 'Source' },
  whipEndpoint:      { description: 'WHIP server URL for live output streaming. POST endpoint that accepts an SDP offer and returns an SDP answer (MediaMTX, OBS WHIP, Cloudflare Stream, LiveKit, etc.).', panel: 'Share' },
  whipBearerToken:   { description: 'Optional Bearer token for authenticated WHIP servers (Cloudflare Stream, LiveKit Cloud). Leave empty for open/local servers. Stored locally — not exported in presets.', panel: 'Share' },
  videoAudioEnabled:       { description: 'Unmute the video file or stream source so its audio plays through system speakers. Disabled on every page load to prevent accidental sound.', panel: 'Source' },
  videoAudioVolume:        { description: 'Output level for the video audio track. 0 = silent, 1 = full. Only active when Video Audio is enabled.', panel: 'Source' },
  recordIncludeVideoAudio: { description: 'Bake the video file or stream audio track into the recording. Independent of the speaker-playback toggle — you can record the audio without hearing it, or vice versa. No effect when the active source has no audio track.', panel: 'Record' },
  anaglyphEnabled: { description: 'Switch the main canvas to red-cyan anaglyph mode. View with standard red-cyan glasses. Post-processing (bloom, CRT, feedback) is paused while active. Recording and streaming automatically capture the anaglyph output.', panel: 'Camera' },
  anaglyphIpdCm:   { description: 'Eye separation for anaglyph rendering in centimetres. Tuned independently from the stereo-recording IPD. Lower values reduce depth intensity; higher values exaggerate it. Typical human IPD is 6.0–6.7 cm.', panel: 'Camera' },

  // ----- Pattern Generator (v10) -----
  patternEnabled:    { description: 'Master toggle for the synthesized pattern layer. When OFF the live video texture feeds the DCU directly (no extra GPU cost).', panel: 'Pattern' },
  patternKind:       { description: 'Which pattern generator to render: calibration (Solid/Gradient/Bars/Grid/Checker), waveform (Sine/Tri/Saw/Square/Pulse Bands, Lissajous, Spiral), noise (White/Perlin/Worley), or Oscilloscope.', panel: 'Pattern' },
  patternBlendMode:  { description: 'How the pattern composites with the video source: Replace, Add, Subtract, Multiply, Screen, Difference, Mask, Crossfade.', panel: 'Pattern' },
  patternMix:        { description: 'Wet/dry between the unmodified video and the blended result. 0 = video only; 1 = full pattern blend.', range: '0..1', panel: 'Pattern' },
  videoCompositeMix: { description: 'The Patch Bay Composite node’s wet/dry: 0 = input A alone, 1 = the full blend of A and B. Only has an effect once the Composite node is actually wired into RENDERER IN.', range: '0..1', panel: 'Source' },
  patternBrightness: { description: 'Master brightness applied to the generated pattern.', range: '0..1', panel: 'Pattern' },
  patternContrast:   { description: 'Contrast applied around 0.5 mid-gray; values >1 push toward black/white extremes.', range: '0..2', panel: 'Pattern' },
  patternFrequency:  { description: 'Cycles per frame for waveform / band patterns. Modulate with an LFO for animated stripes.', range: '0..64', panel: 'Pattern' },
  patternPhase:      { description: 'Phase offset (radians). Scrolls bands; rotates gradient direction; rotates spiral.', range: '0..2π', panel: 'Pattern' },
  patternScale:      { description: 'Scale multiplier for grid / spiral / noise patterns. Larger = coarser features.', range: '0.05..16', panel: 'Pattern' },
  patternThickness:  { description: 'Line / bar / Lissajous trace half-width in normalized units. Acts as duty cycle for Pulse Bands.', range: '0..1', panel: 'Pattern' },
  patternDensity:    { description: 'Cell or feature count per row (Checker, point density for some patterns).', range: '1..64', panel: 'Pattern' },
  patternFreqRatio:  { description: 'Lissajous Y-frequency / X-frequency ratio. Integer ratios produce closed figures.', range: '0.1..16', panel: 'Pattern' },
  patternPhaseOffset:{ description: 'Lissajous Y-axis phase offset (radians); π/2 produces a circle when freqRatio=1.', range: '0..2π', panel: 'Pattern' },
  patternArms:       { description: 'Number of arms in the Spiral pattern.', range: '1..16', panel: 'Pattern' },
  patternOctaves:    { description: 'Perlin-noise octave count. More octaves = richer detail at GPU cost.', range: '1..6', panel: 'Pattern' },
  patternPointDensity:{ description: 'Worley-noise feature-point density. Higher = more cells.', range: '0.5..32', panel: 'Pattern' },
  patternAxis:       { description: 'Direction for waveform / bars patterns: horizontal, vertical, both (XOR), or radial.', panel: 'Pattern' },
  patternGradientShape:{ description: 'Gradient shape: linear (uses Phase as direction angle) or radial (Phase shifts the origin).', panel: 'Pattern' },
  patternScopeSourceKind: { description: 'Where the oscilloscope trace samples its signal: live audio, a Classic mod-matrix slot, a Graph node port, a numeric Settings key, or BeatDetector pulses.', panel: 'Pattern' },
  patternScopeSourceRef:  { description: 'Reference for the chosen scope source. Audio: ignored. Classic Slot: 1-4. Graph Node: "<nodeId>:<port>" (default port "out"). Settings Param: any numeric Settings key (e.g. "zPush").', panel: 'Pattern' },
  patternScopeSweep:      { description: 'Horizontal sweep speed: how many buffer windows fit on screen. Higher = compressed time view.', range: '0.1..4', panel: 'Pattern' },
  patternScopeTrigger:    { description: 'Rising-edge trigger threshold. 0 disables triggering. Otherwise the trace re-aligns each frame to the first rising crossing of this level — periodic waveforms stay locked.', range: '-1..1', panel: 'Pattern' },
  patternScopePersist:    { description: 'Phosphor-decay amount. 0 = no trail; 0.99 = long persistent glow. Implemented via a feedback render target.', range: '0..0.99', panel: 'Pattern' },
  patternScopeThickness:  { description: 'Beam half-width in pixels.', range: '0.5..8', panel: 'Pattern' },
  patternScopeBeamHue:    { description: 'Trace color (HSV hue, full saturation). 0.33 ≈ phosphor green, 0 ≈ red, 0.67 ≈ blue.', range: '0..1', panel: 'Pattern' },

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
  aspect:     { description: 'Width-to-height ratio of the raster (4:3 matches the original hardware).', range: '0.25..4', panel: 'DCU' },
  hCenter:    { description: 'Horizontal pivot for the spin/rotation transforms. Voltage-controllable — route CV, MIDI, or a modulation slot to it like any other target.', range: '-1..1', panel: 'DCU' },
  vCenter:    { description: 'Vertical pivot for the spin/rotation transforms. The original hardware had no voltage input here; this implementation follows the modified hardware reference and exposes it as a modulation target.', range: '-1..1', panel: 'DCU' },
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
  rotate90:   { description: 'Rotate the entire raster 90° (switch). Composes with the continuous Rotation knob.', panel: 'DCU' },
  rotation:   { description: 'Continuous in-plane rotation of the raster (degrees), pivoting on H/V Center, composed after the 0/90 switch. Modulatable — patch an LFO for a slow tumble.', range: '-180..180', panel: 'DCU' },

  // ----- Dual raster (v23) -----
  dualRasterEnabled: { description: 'Render a second, independently modulated raster (B) from the same video signal — a dual-trace scope on the bench. OFF = the classic single-raster path, completely unchanged.', panel: 'DCU' },
  dualMode:     { description: 'Wipe: the trace slider splits the frame (B on top, A below, both full resolution). Alternate: rasters interleave row-by-row at half vertical resolution each; the slider does not apply.', panel: 'DCU' },
  dualTracePos: { description: 'Dual-trace wipe position: 0 = all raster A, 1 = all raster B. Modulatable — sweep it with an LFO or CV for a live wipe.', range: '0..1', panel: 'DCU' },
  bHPos:       { description: 'Raster B: horizontal centering.', panel: 'DCU' },
  bVPos:       { description: 'Raster B: vertical centering.', panel: 'DCU' },
  bHSize:      { description: 'Raster B: horizontal stretch (bipolar; through zero collapses).', panel: 'DCU' },
  bVSize:      { description: 'Raster B: vertical stretch (bipolar).', panel: 'DCU' },
  bZPush:      { description: 'Raster B: brightness-to-Z displacement.', range: '-4..4', panel: 'DCU' },
  bZBias:      { description: 'Raster B: Z offset before displacement.', range: '-2..2', panel: 'DCU' },
  bIntensity:  { description: 'Raster B: scanline brightness multiplier.', range: '0..3', panel: 'DCU' },
  bHCenter:    { description: 'Raster B: horizontal rotation pivot.', range: '-1..1', panel: 'DCU' },
  bVCenter:    { description: 'Raster B: vertical rotation pivot.', range: '-1..1', panel: 'DCU' },
  bHSpin:      { description: 'Raster B: rotation around the horizontal axis (radians).', panel: 'DCU' },
  bVSpin:      { description: 'Raster B: rotation around the vertical axis (radians).', panel: 'DCU' },
  bRotation:   { description: 'Raster B: continuous in-plane rotation (degrees).', range: '-180..180', panel: 'DCU' },
  bHLinearity: { description: 'Raster B: horizontal linearity bow.', panel: 'DCU' },
  bVLinearity: { description: 'Raster B: vertical linearity bow.', panel: 'DCU' },
  bThreshold:  { description: 'Raster B: black-crush threshold.', range: '0..1', panel: 'DCU' },
  bContrast:   { description: 'Raster B: contrast before scanning.', range: '0..3', panel: 'DCU' },
  bGamma:      { description: 'Raster B: gamma correction.', range: '0.2..3', panel: 'DCU' },
  'modSlot.freqRange': { description: 'Coarse LFO range switch: Low ×0.01, Mid ×1, High ×10 on the dialed Rate (Free sync only). High above ~20 Hz effective is stroboscopic — modulation is computed per frame, so it aliases against the frame rate.', panel: 'Modulation' },

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
  feedbackEnabled:  { description: 'Long-exposure feedback trails (CRT burn-in). Each frame is max-blended with the decaying previous output, so trails appear wherever bright content moves or fades. The trail history resets on every enable.', panel: 'Color/PostFX' },
  feedbackDecay:    { description: 'Per-frame trail retention. 0.9 ≈ 0.1 s half-life (tight motion smear), 0.99 ≈ 1 s (comet tails), 0.999 ≈ 11 s (true burn-in).', range: '0.5..0.999', panel: 'Color/PostFX' },
  feedbackShape:    { description: 'Confine feedback trails to a region: Full frame (classic), Circle, or Box. The shape can be moved live — its center, radius, and softness are all modulation targets.', panel: 'Color/PostFX' },
  feedbackShapeX:   { description: 'Feedback shape center, horizontal (0 = left, 1 = right). Patch an LFO here to orbit the trail region around the frame.', range: '0..1', panel: 'Color/PostFX' },
  feedbackShapeY:   { description: 'Feedback shape center, vertical (0 = top, 1 = bottom).', range: '0..1', panel: 'Color/PostFX' },
  feedbackShapeRadius:   { description: 'Feedback shape size (circle radius or box half-width, UV units).', range: '0.05..0.8', panel: 'Color/PostFX' },
  feedbackShapeSoftness: { description: 'Feather width at the shape edge. 0 = hard cut.', range: '0..0.5', panel: 'Color/PostFX' },
  analogEnabled:    { description: 'Analog character layer: video grain, tape-style dropout lines, and a rolling hum bar — the worn-signal wear-and-tear aesthetic.', panel: 'Color/PostFX' },
  analogNoise:      { description: 'Per-pixel video grain amount.', range: '0..1', panel: 'Color/PostFX' },
  analogDropout:    { description: 'Probability scaler for one-frame horizontal dropout tears.', range: '0..1', panel: 'Color/PostFX' },
  analogHum:        { description: 'Depth of the slow-rolling horizontal hum bar (mains interference on an old monitor).', range: '0..1', panel: 'Color/PostFX' },

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
  renderResolutionId:     { description: 'GPU render resolution, independent of window size. "Match Window" (default) tracks the display; SD/HD/4K presets lock the render target to a fixed pixel count. Recording output uses this resolution.', panel: 'Camera' },
  renderFitMode:          { description: 'How to display the render target when its aspect ratio differs from the window. Letterbox = pixel-accurate with black bars (best for recording). Fill = no bars, edges cropped. Stretch = aspect-correct render scaled to fill window.', panel: 'Camera' },
  renderResolutionCustomW: { description: 'Custom render width in pixels (only active when Resolution is set to "Custom…").', range: '256..7680', panel: 'Camera' },
  renderResolutionCustomH: { description: 'Custom render height in pixels (only active when Resolution is set to "Custom…").', range: '256..7680', panel: 'Camera' },

  // ----- Modulation -----
  modSlots:        { description: 'Up to 4 modulation slots. Each routes a source through a per-slot output stage to a target parameter.', panel: 'Modulation' },
  internalBpm:     { description: 'Global Tempo, shared by Timeline playback, Classic LFOs in Tempo sync mode, and the Graph Clock node. There is no per-timeline BPM in v8 — set it once here.', range: '20..300', panel: 'Modulation' },
  modSlotExpanded: { description: 'UI-only: which slots are currently showing their expanded controls. Excluded from preset export.', panel: 'Modulation' },
  'modSlot.syncMode':      { description: 'How the LFO clock is generated: Free (slot Hz), MIDI (locked to incoming MIDI clock — holds last rate when silent, no fallback), or Tempo (locked to global Tempo BPM).', panel: 'Modulation' },
  'modSlot.lfoDepth':      { description: 'LFO amplitude before the output stage. 1 = full swing, 0 = silent.', range: '0..1', panel: 'Modulation' },
  'modSlot.lfoUnipolar':   { description: 'When ON, the LFO output is remapped from -1..+1 to 0..+1 (handy for parameters that dislike going negative, e.g. zPush below 0).', panel: 'Modulation' },
  'modSlot.audioAttackMs': { description: 'Per-slot envelope follower attack on the audio source. Shorter = snappier, longer = smoother.', range: '1..1000 ms', panel: 'Modulation' },
  'modSlot.audioReleaseMs':{ description: 'Per-slot envelope follower release on the audio source.', range: '1..5000 ms', panel: 'Modulation' },
  'modSlot.audioGain':     { description: 'Multiplier on the audio envelope before clamping.', range: '0..4', panel: 'Modulation' },
  'modSlot.audioFloor':    { description: 'Noise gate: any audio below this value clamps to 0 before the follower runs.', range: '0..1', panel: 'Modulation' },
  'modSlot.joystickSmoothMs': { description: '1-pole low-pass on the joystick axis (per slot). Smooths jittery touchpad input.', range: '0..500 ms', panel: 'Modulation' },
  'modSlot.joystickDeadzone': { description: 'Treat axis values within ±deadzone as exactly 0 (kills idle drift).', range: '0..0.5', panel: 'Modulation' },
  'modSlot.joystickInvert':   { description: 'Flip the sign of the joystick axis read by this slot.', panel: 'Modulation' },
  'modSlot.rampLoop':         { description: 'When OFF, the ramp runs once and holds at its end value (one-shot envelope). Useful for triggered sweeps.', panel: 'Modulation' },
  'modSlot.outputCurve':      { description: 'Shape applied to the source value: Linear (no change), Exp (squashed near 0), Log (boosted near 0), S-curve (sigmoid), Step (3-level quantize).', panel: 'Modulation' },
  'modSlot.outputMin':        { description: 'Lower bound of the output stage. Bipolar sources -1..+1 are remapped to [Min, Max].', range: '-2..2', panel: 'Modulation' },
  'modSlot.outputMax':        { description: 'Upper bound of the output stage.', range: '-2..2', panel: 'Modulation' },
  'modSlot.outputOffset':     { description: 'DC offset added after curve + range mapping.', range: '-1..1', panel: 'Modulation' },
  'modSlot.outputInvert':     { description: 'Multiply the post-output-stage value by -1 right before the Amount knob.', panel: 'Modulation' },
  'modSlot.mode':             { description: 'How the slot applies to its target: Additive sums an offset onto the base value; Multiplicative contributes a (1 + value × amount) factor — the classic patched-multiplier, great for tremolo/VCA-style depth control of other modulation. Live value = (base + offsets) × factors.', panel: 'Modulation' },
  'modSlot.slewRiseMs':       { description: 'Glide time when the slot value rises. 0 = instant (off). Smooths stepped sources — a Step-curve LFO with 200 ms slew becomes a portamento staircase.', range: '0..5000 ms', panel: 'Modulation' },
  'modSlot.slewFallMs':       { description: 'Glide time when the slot value falls. 0 = instant (off). Same exponential slew as the Graph Slew node.', range: '0..5000 ms', panel: 'Modulation' },
  'modSlot.constantValue':    { description: 'Value emitted by the Constant source. Useful as a static offset whose Amount can be modulated by another slot or by MIDI.', range: '-1..1', panel: 'Modulation' },

  // ----- MIDI -----
  midiInputId:    { description: 'Selected MIDI input device.', panel: 'MIDI' },
  midiOutputId:   { description: 'Selected MIDI output device (for slot CC echo and Clock Out).', panel: 'MIDI' },
  midiClockOutEnabled: { description: 'Transmit 24-PPQ MIDI clock (plus Start/Stop) at the shared Tempo BPM on the selected output, so external gear chases the synth. Forced OFF on every page load — re-arm per session.', panel: 'MIDI' },
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

  // ----- CV (v9) -----
  cvEnabled:           { description: 'Master enable for the audio-interface CV reader. Controlled by the Start/Stop button in I/O → CV.', panel: 'CV' },
  cvDeviceId:          { description: 'mediaDevices ID of the DC-coupled audio interface used as a CV source.', panel: 'CV' },
  cvRequestedChannels: { description: 'How many channels to request from the audio interface. Browsers may grant fewer; truncated count surfaces a warning.', range: '1..32', panel: 'CV' },
  cvChannels:          { description: 'Per-channel CV config: enable, label, voltage range, polarity, smoothing, control rate, calibration offset, invert.', panel: 'CV' },
  cvBridgeChannels:    { description: 'OSC-bridge CV channels (Route C). Each maps an OSC address (e.g. /cv/1) to a normalized signal with configurable input range and polarity.', panel: 'CV' },
  gamepadIndex:        { description: 'Selected gamepad index from navigator.getGamepads(), or -1 = none.', panel: 'CV' },
  gamepadDeadzone:     { description: 'Deadzone applied to gamepad axes (any value within ±deadzone is treated as 0).', range: '0..0.5', panel: 'CV' },

  cvOutputEnabled:       { description: 'Master switch for CV output. Stays false on every page load until you click Start in I/O → CV Out, even if it was on when you saved.', panel: 'CV' },
  cvOutputDeviceId:      { description: 'mediaDevices ID of the audio interface that the CV output AudioContext targets via setSinkId. DC-coupled interfaces only.', panel: 'CV' },
  cvOutputChannelCount:  { description: 'How many output channels to open on the merger. Capped to the interface\'s maxChannelCount.', range: '1..32', panel: 'CV' },
  cvOutputChannels:      { description: 'Per-channel CV-output config: type (cv/gate/trigger/clock/pitch), source binding, voltage range, scale, offset, smoothing, plus type-specific fields. enabled is force-reset to false on every load.', panel: 'CV' },

  // ----- Record -----
  recordPreferredFormat: { description: 'Preferred container/codec for recordings.', panel: 'Record' },
  recordFps:             { description: 'Capture frame rate.', panel: 'Record' },
  recordBitrateMbps:     { description: 'Video bitrate in Mbps. Range: 1–100. Default 25 Mbps. Line art and thin meshes need higher bitrate than typical video — use 50–100 Mbps for 4K or when fine wire detail must be preserved.', panel: 'Record' },
  recordIncludeMic:      { description: 'Mix the microphone into the recording.', panel: 'Record' },

  // ----- Stereoscopic recording (v12) -----
  stereoRecordingEnabled: {
    description: 'Record side-by-side stereoscopic 3D video. The output file is twice as wide as the configured resolution (left eye on the left half, right eye on the right). YouTube auto-detects 3D when MP4 is available; non-MP4 browsers still produce valid side-by-side files for manual upload tagging.',
    panel: 'Record',
  },
  stereoIpdCm: {
    description: 'Interpupillary distance for the stereo offset, in centimeters. 6.3cm is average human IPD. Smaller = subtler 3D (more comfortable), larger = exaggerated depth.',
    range: '1.0..15.0',
    panel: 'Record',
  },
  stereoInjectMetadata: {
    description: 'Inject the YouTube SV3D metadata box into the MP4 on stop, so YouTube recognizes the upload as 3D automatically. Off = raw side-by-side file with no metadata (for external editing / non-YouTube workflows). No effect on WebM recordings.',
    panel: 'Record',
  },
  stereoFormat: {
    description: 'Frame layout for stereoscopic recording. v1 ships side-by-side; top-bottom and anaglyph are reserved for later stages.',
    panel: 'Record',
  },

  // ----- XR (v11) -----
  xrMeshScale: {
    description: 'How big the scanline mesh appears when you put on a headset. Tabletop ≈ desk model (default), Roomscale ≈ walk-through, Architectural ≈ stand-still-and-look. Picked before Enter VR/AR and changeable mid-session.',
    panel: 'XR',
  },
  xrAutoEndOnVisibilityChange: {
    description: 'End the XR session automatically when this browser tab is hidden (minimize, tab switch). Alt-tabbing to a different window does NOT count — the tab is still visible, so Quest Link / SteamVR keeps rendering.',
    panel: 'XR',
  },
  xrPerformanceProfile: {
    description: 'Performance profile applied during XR sessions, separate from the desktop profile. Stereo rendering doubles GPU load so balanced is the default. Auto picks based on detected headset hint.',
    panel: 'XR',
  },

  // ----- UI -----
  panelDock:        { description: 'Side panel docks to the left or right edge.', panel: 'UI' },
  panelCollapsed:   { description: 'Side panel collapsed state.', panel: 'UI' },
  panelTab:         { description: 'Active top-level panel tab.', panel: 'UI' },
  hudVisible:       { description: 'Show on-screen FPS/source HUD.', panel: 'UI' },
  helpAutoOpen:     { description: 'Auto-open this manual on first run.', panel: 'UI' },
  timelineDock:     { description: 'Position of the timeline dock: top, bottom, or hidden.', panel: 'UI' },
  paramRangeOverrides: { description: 'Per-parameter custom slider ranges. Right-click any slider (or tap its readout) and edit the Custom Range fields — widen for extra headroom (up to 5× the stock span past each bound) or narrow for a vernier. The number box glows when a custom range is active. Reset Range restores stock bounds.', panel: 'UI' },
  timelineHeight:   { description: 'Pixel height of the timeline dock. Drag the dock’s free edge (top edge when docked bottom) to resize; clamped 140–600.', panel: 'UI' },
  timelineInspectorWidth: { description: 'Pixel width of the timeline dock’s inspector column. Drag the column’s left edge to resize; clamped 180–420.', panel: 'UI' },
  panelWidth:       { description: 'Pixel width of the side control panel. Drag the panel’s inner edge to resize; clamped 280–600.', panel: 'UI' },
  timelineReadoutFormat: { description: 'Transport counter display: Bars/Beats (the real clock), Timecode (HH:MM:SS:FF), Frames, or Samples. Purely a display conversion — playback and authoring stay bar/BPM-based regardless.', panel: 'UI' },
  timelineReadoutFps: { description: 'Frame rate used to render the Timecode/Frames counter display. Notational only — independent of Record’s capture FPS.', panel: 'UI' },
  timelineReadoutSampleRate: { description: 'Sample rate used to render the Samples counter display. Notational only — independent of the audio hardware’s actual rate.', panel: 'UI' },
  renderScale:      { description: 'Supersampling factor for anti-aliasing. 1.0 = native resolution; higher values render at a larger size then downsample, smoothing sharp scanline edges at a GPU-time cost.', range: '0.5..1.5', panel: 'UI' },
  hapticsEnabled:   { description: 'Vibrate on keyframe-reached / preset-load events. Touch devices default on; no-op on desktop (no vibration hardware).', panel: 'UI' },
  wakeLockOnRecord: { description: 'Request a screen wake-lock while recording or broadcasting, so the display doesn’t sleep mid-capture.', panel: 'UI' },
};
