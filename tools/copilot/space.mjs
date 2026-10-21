// The look space the copilot samples: the 39-key "first set" (schema SCHEMA.md section 7),
// with the Controls-slider ranges (what a user can reach), the app's defaults, and the
// 12 built-in presets restricted to these keys. Pure data; tools/copilot/space.test.mjs
// checks every default and preset value against the app's own DEFAULTS and PRESETS, so a
// change in the app fails the test instead of silently skewing the samples.
//
// prior: how a BROAD sample draws the key (sampler.mjs):
//   lin [a,b]      uniform
//   log [a,b]      log-uniform (perceptual: depth, line counts, glow, contrast)
//   pow [a,b] k    a + (b-a) * u^k  (k > 1 leans toward a)
//   spike p v      with probability p exactly v (the neutral value), else the rest of the prior
//   bool p         true with probability p
//   enum w         weighted choice
// Gated values are emitted at their DEFAULT when their gate is off (they change nothing on
// screen then, so a random value would be a label the picture cannot show).

export const KEYS = {
  // Relief (11)
  zPush:      { type: 'number', min: 0, max: 4, step: 0.001, def: 0.9, prior: { kind: 'log', a: 0.08, b: 4, spike: [0.05, 0] } },
  zInvert:    { type: 'boolean', def: false, prior: { kind: 'bool', p: 0.15 } },
  zBias:      { type: 'number', min: -2, max: 2, step: 0.001, def: 0, prior: { kind: 'normal', mu: 0, sigma: 0.5, spike: [0.7, 0] } },
  threshold:  { type: 'number', min: 0, max: 1, step: 0.001, def: 0.04, prior: { kind: 'log', a: 0.005, b: 0.7, spike: [0.1, 0] } },
  contrast:   { type: 'number', min: 0, max: 4, step: 0.001, def: 1, prior: { kind: 'log', a: 0.3, b: 4 } },
  gamma:      { type: 'number', min: 0.2, max: 4, step: 0.001, def: 1, prior: { kind: 'log', a: 0.2, b: 4 } },
  focus:      { type: 'number', min: 0, max: 1, step: 0.001, def: 0, prior: { kind: 'pow', a: 0, b: 1, k: 1.5, spike: [0.4, 0] } },
  intensity:  { type: 'number', min: 0, max: 2, step: 0.001, def: 1, prior: { kind: 'lin', a: 0.3, b: 2 } },
  scanRate:   { type: 'number', min: 30, max: 600, step: 1, def: 240, prior: { kind: 'log', a: 30, b: 600 } },
  cols:       { type: 'number', min: 30, max: 600, step: 1, def: 320, prior: { kind: 'log', a: 30, b: 600 } },
  skip:       { type: 'number', min: 0, max: 0.95, step: 0.001, def: 0, prior: { kind: 'lin', a: 0, b: 0.95, spike: [0.75, 0] } },
  // Raster shape (7)
  hSize:      { type: 'number', min: -2, max: 2, step: 0.001, def: 1, prior: { kind: 'size', spike: [0.5, 1] } },
  vSize:      { type: 'number', min: -2, max: 2, step: 0.001, def: 1, prior: { kind: 'size', spike: [0.5, 1] } },
  hLinearity: { type: 'number', min: -1, max: 1, step: 0.001, def: 0, prior: { kind: 'normal', mu: 0, sigma: 0.35, spike: [0.6, 0] } },
  vLinearity: { type: 'number', min: -1, max: 1, step: 0.001, def: 0, prior: { kind: 'normal', mu: 0, sigma: 0.35, spike: [0.6, 0] } },
  rotation:   { type: 'number', min: -180, max: 180, step: 0.1, def: 0, prior: { kind: 'rotation' } },
  hSpin:      { type: 'number', min: -Math.PI, max: Math.PI, step: 0.001, def: 0, prior: { kind: 'normal', mu: 0, sigma: 0.6, spike: [0.65, 0] } },
  vSpin:      { type: 'number', min: -Math.PI, max: Math.PI, step: 0.001, def: 0, prior: { kind: 'normal', mu: 0, sigma: 0.6, spike: [0.65, 0] } },
  // Colour (3)
  colorMode:  { type: 'enum', def: 'phosphorGreen', values: ['grayscale', 'phosphorGreen', 'phosphorAmber', 'phosphorCustom', 'video'],
                prior: { kind: 'enum', w: [1, 1, 1, 1.2, 0.8] } },
  customTint: { type: 'color', def: '#5fff85', gate: { colorMode: 'phosphorCustom' }, prior: { kind: 'tint' } },
  backgroundColor: { type: 'color', def: '#050807', prior: { kind: 'background' } },
  // Glow and CRT (15)
  bloomEnabled:      { type: 'boolean', def: false, prior: { kind: 'bool', p: 0.55 } },
  bloomIntensity:    { type: 'number', min: 0, max: 3, step: 0.001, def: 0.85, gate: { bloomEnabled: true }, prior: { kind: 'log', a: 0.1, b: 3 } },
  bloomRadius:       { type: 'number', min: 0, max: 2, step: 0.001, def: 0.6, gate: { bloomEnabled: true }, prior: { kind: 'lin', a: 0.05, b: 2 } },
  bloomThreshold:    { type: 'number', min: 0, max: 1, step: 0.001, def: 0.15, gate: { bloomEnabled: true }, prior: { kind: 'pow', a: 0, b: 1, k: 2 } },
  scanlineEnabled:   { type: 'boolean', def: true, prior: { kind: 'bool', p: 0.7 } },
  scanlineIntensity: { type: 'number', min: 0, max: 1, step: 0.001, def: 0.18, gate: { scanlineEnabled: true }, prior: { kind: 'pow', a: 0, b: 1, k: 1.5 } },
  scanlineDensity:   { type: 'number', min: 100, max: 2000, step: 1, def: 720, gate: { scanlineEnabled: true }, prior: { kind: 'log', a: 100, b: 2000 } },
  vignetteEnabled:   { type: 'boolean', def: true, prior: { kind: 'bool', p: 0.65 } },
  vignetteAmount:    { type: 'number', min: 0, max: 1, step: 0.001, def: 0.55, gate: { vignetteEnabled: true }, prior: { kind: 'lin', a: 0, b: 1 } },
  feedbackEnabled:   { type: 'boolean', def: false, prior: { kind: 'bool', p: 0.25 } },
  // 1 - decay is log-uniform over [0.001, 0.5]: as many "long trail" as "short trail" looks.
  feedbackDecay:     { type: 'number', min: 0.5, max: 0.999, step: 0.001, def: 0.9, gate: { feedbackEnabled: true }, prior: { kind: 'decay' } },
  analogEnabled:     { type: 'boolean', def: false, prior: { kind: 'bool', p: 0.25 } },
  analogNoise:       { type: 'number', min: 0, max: 1, step: 0.001, def: 0.15, gate: { analogEnabled: true }, prior: { kind: 'pow', a: 0, b: 1, k: 1.5 } },
  analogDropout:     { type: 'number', min: 0, max: 1, step: 0.001, def: 0.1, gate: { analogEnabled: true }, prior: { kind: 'pow', a: 0, b: 1, k: 1.5 } },
  analogHum:         { type: 'number', min: 0, max: 1, step: 0.001, def: 0.1, gate: { analogEnabled: true }, prior: { kind: 'pow', a: 0, b: 1, k: 1.5 } },
  // Render and view (3). 'dots' is left out: the renderer draws it exactly like scanlines.
  renderMode: { type: 'enum', def: 'scanlines', values: ['scanlines', 'wireframe'], prior: { kind: 'enum', w: [4, 1] } },
  cameraFov:  { type: 'number', min: 10, max: 120, step: 0.5, def: 50, prior: { kind: 'log', a: 15, b: 120, spike: [0.4, 50] } },
  // Motion: a still cannot show it, so this step pins it off (future work, with modulation).
  autoOrbit:  { type: 'boolean', def: false, fixed: false },
};

export const KEY_NAMES = Object.keys(KEYS);

/** The 12 built-in presets (src/ui/presets.ts), restricted to KEYS. A key a preset does not
 *  set is at its default in a still (every still starts from a reset). Not representable with
 *  these keys: chromaEnabled/chromaAmount (stay at default: on, 0.0025), aspect, and the
 *  camera mode / lens / saved view of 'default' and 'diving'. The three pattern-* presets'
 *  pattern settings are SOURCES here (PATTERN_SOURCES), not look keys. */
export const PRESETS = {
  'default': { zPush: 0.9, zInvert: false, zBias: 0, threshold: 0.04, contrast: 1, gamma: 1, focus: 0, intensity: 1, scanRate: 240, cols: 320, hSize: 1, vSize: 1, hLinearity: 0, vLinearity: 0, colorMode: 'phosphorGreen', customTint: '#5fff85', backgroundColor: '#050807', bloomEnabled: false, bloomIntensity: 0.85, bloomRadius: 0.6, bloomThreshold: 0.15, scanlineEnabled: true, scanlineIntensity: 0.18, scanlineDensity: 720, vignetteEnabled: true, vignetteAmount: 0.55, feedbackEnabled: false, feedbackDecay: 0.9, renderMode: 'scanlines', cameraFov: 50 },
  'classic-1974': { zPush: 1.1, zInvert: false, zBias: 0, threshold: 0.06, contrast: 1.1, gamma: 1, focus: 0, intensity: 1, hSize: 1, vSize: 1, hLinearity: 0.05, vLinearity: 0.05, colorMode: 'grayscale', backgroundColor: '#000000', bloomEnabled: true, bloomIntensity: 0.4, bloomRadius: 0.4, bloomThreshold: 0.2, scanlineEnabled: true, scanlineIntensity: 0.1, scanlineDensity: 600, vignetteEnabled: true, vignetteAmount: 0.4, feedbackEnabled: false },
  'phosphor-green': { zPush: 0.9, focus: 0.15, intensity: 1.1, colorMode: 'phosphorGreen', backgroundColor: '#02100a', bloomEnabled: true, bloomIntensity: 1.2, bloomRadius: 0.8, bloomThreshold: 0.05, scanlineEnabled: true, scanlineIntensity: 0.22, scanlineDensity: 720, vignetteEnabled: true, vignetteAmount: 0.6 },
  'amber-terminal': { zPush: 0.7, focus: 0.1, intensity: 1, colorMode: 'phosphorAmber', backgroundColor: '#0c0703', bloomEnabled: true, bloomIntensity: 0.95, bloomRadius: 0.7, bloomThreshold: 0.1, scanlineEnabled: true, scanlineIntensity: 0.3, scanlineDensity: 540, vignetteEnabled: true, vignetteAmount: 0.7 },
  'sampled-video': { zPush: 0.9, zBias: 0, threshold: 0.04, contrast: 1.1, gamma: 1, focus: 0.05, intensity: 1.15, colorMode: 'video', backgroundColor: '#000000', bloomEnabled: true, bloomIntensity: 0.6, bloomRadius: 0.5, bloomThreshold: 0.15, scanlineEnabled: true, scanlineIntensity: 0.12, scanlineDensity: 640, vignetteEnabled: true, vignetteAmount: 0.45, feedbackEnabled: false, renderMode: 'scanlines' },
  'wireframe': { zPush: 1.4, zBias: 0, threshold: 0, contrast: 1, gamma: 1, focus: 0, intensity: 1.2, scanRate: 180, cols: 240, colorMode: 'video', backgroundColor: '#000000', bloomEnabled: false, scanlineEnabled: false, vignetteEnabled: false, feedbackEnabled: false, renderMode: 'wireframe' },
  'heavy-bloom': { zPush: 1.6, threshold: 0.12, contrast: 1.5, gamma: 0.9, focus: 0.25, intensity: 1.4, colorMode: 'phosphorCustom', customTint: '#9fffe0', backgroundColor: '#02060a', bloomEnabled: true, bloomIntensity: 2.2, bloomRadius: 1.2, bloomThreshold: 0, scanlineEnabled: true, scanlineIntensity: 0.18, scanlineDensity: 800, vignetteEnabled: true, vignetteAmount: 0.75 },
  'burn-in': { zPush: 0.9, focus: 0.05, intensity: 1, colorMode: 'phosphorGreen', backgroundColor: '#000000', bloomEnabled: true, bloomIntensity: 0.8, bloomRadius: 0.5, bloomThreshold: 0.1, scanlineEnabled: true, scanlineIntensity: 0.18, scanlineDensity: 720, vignetteEnabled: true, vignetteAmount: 0.6, feedbackEnabled: true, feedbackDecay: 0.94 },
  'diving': { zPush: 1.4, intensity: 1.2, colorMode: 'phosphorGreen', backgroundColor: '#000000', bloomEnabled: true, bloomIntensity: 1, bloomRadius: 0.7, scanlineEnabled: true, scanlineIntensity: 0.18, vignetteEnabled: true, vignetteAmount: 0.55, cameraFov: 80 },
  'pattern-terrain': { zPush: 1.4, focus: 0.1, intensity: 0.85, colorMode: 'phosphorGreen', backgroundColor: '#000000', bloomEnabled: true, bloomIntensity: 0.5, bloomRadius: 0.5, bloomThreshold: 0.3, scanlineEnabled: true, scanlineIntensity: 0.15, vignetteEnabled: true, vignetteAmount: 0.5 },
  'pattern-lissajous': { zPush: 1, intensity: 1.2, colorMode: 'phosphorGreen', backgroundColor: '#02100a', bloomEnabled: true, bloomIntensity: 1.2, bloomRadius: 0.8, bloomThreshold: 0.05, scanlineEnabled: true, scanlineIntensity: 0.2, vignetteEnabled: true, vignetteAmount: 0.55 },
  'pattern-cells': { zPush: 1.2, intensity: 1, colorMode: 'phosphorAmber', backgroundColor: '#0c0703', bloomEnabled: true, bloomIntensity: 0.95, bloomRadius: 0.7, bloomThreshold: 0.1, scanlineEnabled: true, scanlineIntensity: 0.25, vignetteEnabled: true, vignetteAmount: 0.6 },
};

/** Camera-less sources: the Pattern Generator, kind and EVERY parameter of that kind sent
 *  explicitly (loading patternKind does not apply the kind's registry defaults; only the UI
 *  dropdown does). Blend 'replace' at mix 1: with no video the other modes blend against black.
 *  The first three are the pattern-* presets' own settings. */
const PATTERN_BASE = { patternEnabled: true, patternBlendMode: 'replace', patternMix: 1 };
export const PATTERN_SOURCES = {
  'pattern:perlin': { ...PATTERN_BASE, patternKind: 'perlinNoise', patternBrightness: 0.75, patternContrast: 1.3, patternScale: 3, patternOctaves: 4 },
  'pattern:lissajous': { ...PATTERN_BASE, patternKind: 'lissajous', patternBrightness: 1, patternFrequency: 3, patternFreqRatio: 2, patternPhaseOffset: 1.570796, patternThickness: 0.02 },
  'pattern:worley': { ...PATTERN_BASE, patternKind: 'worleyNoise', patternBrightness: 0.9, patternContrast: 1.2, patternScale: 1, patternPointDensity: 8 },
  'pattern:sinebands': { ...PATTERN_BASE, patternKind: 'sineBands', patternBrightness: 0.8, patternContrast: 1, patternFrequency: 8, patternPhase: 0, patternAxis: 'h' },
  'pattern:spiral': { ...PATTERN_BASE, patternKind: 'spiral', patternBrightness: 0.9, patternContrast: 1, patternArms: 5, patternScale: 1, patternPhase: 0 },
};

/** A pattern-* preset's own picture, preferred when that preset is perturbed. */
export const PRESET_SOURCE = {
  'pattern-terrain': 'pattern:perlin',
  'pattern-lissajous': 'pattern:lissajous',
  'pattern-cells': 'pattern:worley',
};

/** Settings an image source carries: no pattern, and not mirrored (mirrorH defaults on,
 *  a webcam convention; a still reads as its file). */
export const IMAGE_SOURCE_SETTINGS = { patternEnabled: false, mirrorH: false };
