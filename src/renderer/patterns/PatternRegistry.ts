/**
 * Pattern Generator registry — pure-data map from `PatternKind` to its
 * fragment shader source, default param values, and the list of
 * Settings keys it actually consumes. Single source of truth for both
 * the renderer (which uniforms to bind each frame) and the UI (which
 * controls to show; what defaults to apply on kind-switch).
 *
 * Adding a new pattern:
 *   1. Author `shaders/<my-pattern>.frag.glsl`
 *   2. Add a `PatternKind` literal to `Settings.ts`
 *   3. Register the pattern here with its imports, label, defaults,
 *      and the Settings keys it reads
 *
 * No three.js, no DOM — this file is loadable from the about page's
 * auto-generated Pattern Catalog without dragging in renderer runtime.
 */

import { Settings, PatternKind } from '../../state/Settings';
import { OscilloscopeBuffer } from './OscilloscopeBuffer';

import quadVertSrc          from './shaders/quad.vert.glsl?raw';
import compositorFragSrc    from './shaders/compositor.frag.glsl?raw';

import solidFragSrc         from './shaders/solid.frag.glsl?raw';
import gradientFragSrc      from './shaders/gradient.frag.glsl?raw';
import barsFragSrc          from './shaders/bars.frag.glsl?raw';
import gridFragSrc          from './shaders/grid.frag.glsl?raw';
import checkerFragSrc       from './shaders/checker.frag.glsl?raw';

import sineBandsFragSrc     from './shaders/sine-bands.frag.glsl?raw';
import triangleBandsFragSrc from './shaders/triangle-bands.frag.glsl?raw';
import sawBandsFragSrc      from './shaders/saw-bands.frag.glsl?raw';
import squareBandsFragSrc   from './shaders/square-bands.frag.glsl?raw';
import pulseBandsFragSrc    from './shaders/pulse-bands.frag.glsl?raw';
import lissajousFragSrc     from './shaders/lissajous.frag.glsl?raw';
import spiralFragSrc        from './shaders/spiral.frag.glsl?raw';

import whiteNoiseFragSrc    from './shaders/white-noise.frag.glsl?raw';
import perlinNoiseFragSrc   from './shaders/perlin-noise.frag.glsl?raw';
import worleyNoiseFragSrc   from './shaders/worley-noise.frag.glsl?raw';

import oscilloscopeFragSrc  from './shaders/oscilloscope.frag.glsl?raw';

/** Re-exported here so consumers don't need a second import path. */
export const PATTERN_QUAD_VERT_SRC = quadVertSrc;
/** Compositor fragment — reads `uPattern`, `uVideo`, `uBlendMode`,
 *  `uMix`. Used by `PatternRenderer` to combine pattern + video. */
export const PATTERN_COMPOSITOR_FRAG_SRC = compositorFragSrc;

export type PatternCategory = 'calibration' | 'waveform' | 'noise' | 'oscilloscope';

/**
 * Subset of `keyof Settings` that names a pattern parameter the user
 * can edit. Numeric ones are also modulation targets (see `ModTarget`
 * in Settings.ts); enum ones are categorical and not modulatable.
 */
export type PatternParamKey =
  // Common modulatable params
  | 'patternBrightness' | 'patternContrast'
  | 'patternFrequency'  | 'patternPhase'
  | 'patternScale'      | 'patternThickness'
  | 'patternDensity'
  | 'patternFreqRatio'  | 'patternPhaseOffset'
  | 'patternArms'       | 'patternOctaves'
  | 'patternPointDensity'
  // Categorical
  | 'patternAxis' | 'patternGradientShape'
  // Oscilloscope
  | 'patternScopeSourceKind' | 'patternScopeSourceRef'
  | 'patternScopeSweep'      | 'patternScopeTrigger'
  | 'patternScopePersist'    | 'patternScopeThickness'
  | 'patternScopeBeamHue';

/**
 * One internal control signal published by a pattern back into the
 * modulation system. Every numeric signal a pattern emits — Lissajous
 * X / Y, Sine Bands' underlying sine, Oscilloscope mean / trigger —
 * appears here, becomes selectable as a Classic ModSource, drops into
 * the graph as a `pattern-output` node, and is wireable to a CV output
 * channel.
 */
export interface PatternOutputDef {
  /** Pattern-local signal id, e.g. `'x'`, `'wave'`, `'mean'`. */
  id: string;
  /** Human-readable label, e.g. `'Lissajous X'`, `'Sine Bands Wave'`. */
  label: string;
  /** Tooltip / docs description. */
  description: string;
  /** Approximate output range hint. Renderers / docs use this for help text. */
  range: 'unipolar' | 'bipolar';
}

/** Per-frame inputs to a pattern's CPU compute() function. The renderer
 *  builds this once per frame and passes it in; compute() is pure. */
export interface PatternComputeFrame {
  /** Seconds since boot — same `t` the shader's `uTime` would receive. */
  time: number;
  /** Frame delta (clamped) in seconds. */
  dt: number;
  /**
   * Reads a numeric pattern parameter's *live* (post-modulation) value.
   * Closes over `LiveValuesStore.getLive` in production; tests can pass
   * a simple lookup function.
   */
  getLive: (key: string) => number;
  /** Live oscilloscope buffer (only meaningful when the active pattern
   *  is `'oscilloscope'`). Null otherwise. */
  scope: OscilloscopeBuffer | null;
  /** Was a rising-edge trigger detected this frame? Set by the renderer
   *  for the oscilloscope pattern's `trigger` output. */
  triggerHit: boolean;
}

export interface PatternDef {
  /** PatternKind literal. */
  kind: PatternKind;
  /** Human-readable name for UI dropdown. */
  label: string;
  /** Group in the Kind dropdown (also used by the about-page Pattern Catalog). */
  category: PatternCategory;
  /** One-sentence description for tooltips + auto-generated docs. */
  description: string;
  /** Fragment shader source. Compiled lazily by `PatternRenderer`. */
  fragSrc: string;
  /**
   * Settings keys this pattern actually reads. Drives:
   *   - which UI controls render in the per-pattern params host
   *   - which Settings → uniform mappings the renderer applies each frame
   * Order is the order controls appear in the UI.
   */
  paramKeys: readonly PatternParamKey[];
  /**
   * Pattern-specific defaults applied on kind-switch via
   * `settings.patch(defaults)`. Implements the spec's
   * "params reset to defaults per pattern; no stale uniforms" guarantee.
   * Only keys listed in `paramKeys` are touched here — common keys
   * (mix, blend mode) stay at their user-edited values across switches.
   */
  defaults: Partial<Settings>;
  /**
   * Internal control signals published back into the modulation system.
   * Empty / undefined for patterns whose output is purely visual
   * (calibration patterns, noise — there's nothing scalar to extract).
   * The two paths (shader visualization + CPU signal output) share the
   * same parameter state, so they stay in sync by construction.
   */
  outputs?: readonly PatternOutputDef[];
  /**
   * CPU-side mirror of the shader's math, called once per frame by
   * `PatternRenderer.tick()`. Returns the current value of each output
   * declared in `outputs`. Missing keys read as 0.
   *
   * Pattern shaders draw the SPATIAL form of the signal across the
   * frame; this function returns a SCALAR snapshot of the same signal
   * at "time `t`". They share parameters (same Settings keys, same live
   * modulation contributions) so the visible pattern and the published
   * signal evolve in lockstep.
   */
  compute?: (frame: PatternComputeFrame) => Partial<Record<string, number>>;
}

// =====================================================================
// Calibration patterns
// =====================================================================

const SOLID_DEF: PatternDef = {
  kind: 'solid',
  label: 'Solid',
  category: 'calibration',
  description: 'Uniform color at a fixed brightness. Useful for calibrating Z Push response without input noise.',
  fragSrc: solidFragSrc,
  paramKeys: ['patternBrightness'],
  defaults: { patternBrightness: 0.7 },
};

const GRADIENT_DEF: PatternDef = {
  kind: 'gradient',
  label: 'Gradient',
  category: 'calibration',
  description: 'Linear or radial luminance ramp across the frame. The synth\'s "ramp signal" rendered as video.',
  fragSrc: gradientFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternPhase', 'patternGradientShape'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternPhase: 0,
    patternGradientShape: 'linear',
  },
  outputs: [
    { id: 'ramp', label: 'Gradient Ramp',
      description: 'Slow rotation of the gradient direction: sin(phase). Modulate Phase to animate.',
      range: 'bipolar' },
  ],
  compute: (f) => ({ ramp: Math.sin(f.getLive('patternPhase')) }),
};

const BARS_DEF: PatternDef = {
  kind: 'bars',
  label: 'Bars',
  category: 'calibration',
  description: 'Vertical or horizontal stripes with configurable count and contrast. Binary on/off; sharp edges.',
  fragSrc: barsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternThickness', 'patternAxis'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternThickness: 0.5,
    patternAxis: 'v',
  },
};

const GRID_DEF: PatternDef = {
  kind: 'grid',
  label: 'Grid',
  category: 'calibration',
  description: 'Crosshatch grid with configurable density and line width. Closest analog to "wireframe space" as input.',
  fragSrc: gridFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternScale', 'patternThickness'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternScale: 1.0,
    patternThickness: 0.05,
  },
};

const CHECKER_DEF: PatternDef = {
  kind: 'checker',
  label: 'Checkerboard',
  category: 'calibration',
  description: 'Alternating squares with configurable count. Maximum brightness/dark transitions per row.',
  fragSrc: checkerFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternDensity'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternDensity: 8,
  },
};

// =====================================================================
// Waveform patterns
// =====================================================================

const TWO_PI = Math.PI * 2;

/** Phase argument for a waveform-band pattern's CPU mirror: `time *
 *  frequency * 2π + phase`. Sin/cos of this matches the shader's
 *  spatial pattern at the wave's "current cycle position". */
function bandPhase(frame: PatternComputeFrame): number {
  return frame.time * frame.getLive('patternFrequency') * TWO_PI
       + frame.getLive('patternPhase');
}

const SINE_BANDS_DEF: PatternDef = {
  kind: 'sineBands',
  label: 'Sine Bands',
  category: 'waveform',
  description: 'Sine-wave luminance varying across the frame. Modulate frequency for animated stripes.',
  fragSrc: sineBandsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternPhase', 'patternAxis'],
  defaults: {
    patternBrightness: 0.8,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternPhase: 0,
    patternAxis: 'h',
  },
  outputs: [
    { id: 'wave', label: 'Sine Bands Wave',
      description: 'sin(time * frequency * 2π + phase) — the underlying sine that paints the visible bands.',
      range: 'bipolar' },
  ],
  compute: (f) => ({ wave: Math.sin(bandPhase(f)) }),
};

const TRIANGLE_BANDS_DEF: PatternDef = {
  kind: 'triangleBands',
  label: 'Triangle Bands',
  category: 'waveform',
  description: 'Triangle-wave bands. Linear ramps up and down; harder edges than sine.',
  fragSrc: triangleBandsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternPhase', 'patternAxis'],
  defaults: {
    patternBrightness: 0.8,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternPhase: 0,
    patternAxis: 'h',
  },
  outputs: [
    { id: 'wave', label: 'Triangle Bands Wave',
      description: 'Bipolar triangle wave at the configured frequency.', range: 'bipolar' },
  ],
  compute: (f) => {
    const ph = ((bandPhase(f) / TWO_PI) % 1 + 1) % 1;
    // 0 -> -1, 0.5 -> +1, 1 -> -1
    return { wave: 1 - Math.abs(ph * 2 - 1) * 2 };
  },
};

const SAW_BANDS_DEF: PatternDef = {
  kind: 'sawBands',
  label: 'Saw Bands',
  category: 'waveform',
  description: 'Sawtooth-wave bands. Linear ramp followed by sharp drop — useful for "venetian blind" sweeps.',
  fragSrc: sawBandsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternPhase', 'patternAxis'],
  defaults: {
    patternBrightness: 0.8,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternPhase: 0,
    patternAxis: 'h',
  },
  outputs: [
    { id: 'wave', label: 'Saw Bands Wave',
      description: 'Bipolar sawtooth at the configured frequency. Resets sharply.', range: 'bipolar' },
  ],
  compute: (f) => {
    const ph = ((bandPhase(f) / TWO_PI) % 1 + 1) % 1;
    return { wave: ph * 2 - 1 };
  },
};

const SQUARE_BANDS_DEF: PatternDef = {
  kind: 'squareBands',
  label: 'Square Bands',
  category: 'waveform',
  description: 'Hard-edged on/off stripes. The waveform-generator analog of the Bars calibration pattern.',
  fragSrc: squareBandsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternPhase', 'patternAxis'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternPhase: 0,
    patternAxis: 'h',
  },
  outputs: [
    { id: 'wave', label: 'Square Bands Wave',
      description: '50%-duty bipolar square wave at the configured frequency.', range: 'bipolar' },
  ],
  compute: (f) => {
    const ph = ((bandPhase(f) / TWO_PI) % 1 + 1) % 1;
    return { wave: ph < 0.5 ? -1 : 1 };
  },
};

const PULSE_BANDS_DEF: PatternDef = {
  kind: 'pulseBands',
  label: 'Pulse Bands',
  category: 'waveform',
  description: 'Pulse stripes with configurable duty cycle (Thickness). Sparse bright lines on dark, or vice versa.',
  fragSrc: pulseBandsFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternFrequency', 'patternPhase', 'patternThickness', 'patternAxis'],
  defaults: {
    patternBrightness: 1.0,
    patternContrast: 1.0,
    patternFrequency: 8,
    patternPhase: 0,
    patternThickness: 0.25,
    patternAxis: 'h',
  },
  outputs: [
    { id: 'wave', label: 'Pulse Bands Wave',
      description: 'Duty-cycled square pulse (Thickness controls duty). Bipolar -1/+1.', range: 'bipolar' },
  ],
  compute: (f) => {
    const ph = ((bandPhase(f) / TWO_PI) % 1 + 1) % 1;
    const duty = Math.max(0, Math.min(1, f.getLive('patternThickness')));
    return { wave: ph < duty ? 1 : -1 };
  },
};

const LISSAJOUS_DEF: PatternDef = {
  kind: 'lissajous',
  label: 'Lissajous',
  category: 'waveform',
  description: 'Two-oscillator XY trace. Frequency ratio + phase offset shape the curve. Renders as a thin bright line.',
  fragSrc: lissajousFragSrc,
  paramKeys: ['patternBrightness', 'patternFrequency', 'patternFreqRatio', 'patternPhaseOffset', 'patternThickness'],
  defaults: {
    patternBrightness: 1.0,
    patternFrequency: 3,
    patternFreqRatio: 2,
    patternPhaseOffset: Math.PI / 2,
    patternThickness: 0.01,
  },
  outputs: [
    { id: 'x', label: 'Lissajous X',
      description: 'sin(time * frequency) — the X oscillator that draws the curve\'s horizontal motion.',
      range: 'bipolar' },
    { id: 'y', label: 'Lissajous Y',
      description: 'sin(time * frequency * freqRatio + phaseOffset) — the Y oscillator.',
      range: 'bipolar' },
  ],
  compute: (f) => {
    // Match the shader's parametric sweep: `s = i/(N-1) * 2π + uTime * 0.5`.
    // The "current" point of the trace at frame time t corresponds to the
    // s value at the END of the sweep — i.e. s = 2π + t*0.5. Modulo 2π
    // that's just t * 0.5; the published signal is the most recent sample.
    const freq  = f.getLive('patternFrequency');
    const ratio = f.getLive('patternFreqRatio');
    const off   = f.getLive('patternPhaseOffset');
    const s     = f.time * 0.5; // matches the shader's time-driven sweep
    return {
      x: Math.sin(s * freq),
      y: Math.sin(s * freq * ratio + off),
    };
  },
};

const SPIRAL_DEF: PatternDef = {
  kind: 'spiral',
  label: 'Spiral',
  category: 'waveform',
  description: 'Radial sweep with configurable arm count and density. Dizzying when modulated by an LFO.',
  fragSrc: spiralFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternArms', 'patternScale', 'patternPhase'],
  defaults: {
    patternBrightness: 0.9,
    patternContrast: 1.0,
    patternArms: 5,
    patternScale: 1.0,
    patternPhase: 0,
  },
  outputs: [
    { id: 'phase', label: 'Spiral Phase',
      description: 'Spiral rotation phase, sin(uPhase). Useful for syncing other params to the visual rotation.',
      range: 'bipolar' },
  ],
  compute: (f) => ({ phase: Math.sin(f.getLive('patternPhase')) }),
};

// =====================================================================
// Noise patterns
// =====================================================================

const WHITE_NOISE_DEF: PatternDef = {
  kind: 'whiteNoise',
  label: 'White Noise',
  category: 'noise',
  description: 'Per-pixel uncorrelated noise. Re-seeds each frame; great for static, dust, snow.',
  fragSrc: whiteNoiseFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast'],
  defaults: { patternBrightness: 0.8, patternContrast: 1.0 },
};

const PERLIN_NOISE_DEF: PatternDef = {
  kind: 'perlinNoise',
  label: 'Perlin Noise',
  category: 'noise',
  description: 'Smooth procedural noise; scale and octaves shape the texture. Slowly evolves with time.',
  fragSrc: perlinNoiseFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternScale', 'patternOctaves'],
  defaults: {
    patternBrightness: 0.9,
    patternContrast: 1.0,
    patternScale: 4.0,
    patternOctaves: 4,
  },
};

const WORLEY_NOISE_DEF: PatternDef = {
  kind: 'worleyNoise',
  label: 'Worley Noise',
  category: 'noise',
  description: 'Cellular pattern with configurable point density. Produces organic blob-like terrain.',
  fragSrc: worleyNoiseFragSrc,
  paramKeys: ['patternBrightness', 'patternContrast', 'patternScale', 'patternPointDensity'],
  defaults: {
    patternBrightness: 0.9,
    patternContrast: 1.2,
    patternScale: 1.0,
    patternPointDensity: 8,
  },
};

// =====================================================================
// Oscilloscope
// =====================================================================

const OSCILLOSCOPE_DEF: PatternDef = {
  kind: 'oscilloscope',
  label: 'Oscilloscope',
  category: 'oscilloscope',
  description: 'Renders an arbitrary signal (audio, mod source, graph node) as a scope trace. The signal shape becomes the input video, then drives Z-displacement via Z Push — recursive Rutt/Etra video synthesis.',
  fragSrc: oscilloscopeFragSrc,
  paramKeys: [
    'patternScopeSourceKind', 'patternScopeSourceRef',
    'patternBrightness',
    'patternScopeSweep', 'patternScopeTrigger',
    'patternScopePersist', 'patternScopeThickness',
    'patternScopeBeamHue',
  ],
  defaults: {
    patternScopeSourceKind: 'audio',
    patternScopeSourceRef: '',
    patternBrightness: 1.0,
    patternScopeSweep: 1.0,
    patternScopeTrigger: 0,
    patternScopePersist: 0.6,
    patternScopeThickness: 1.5,
    patternScopeBeamHue: 0.33,
  },
  outputs: [
    { id: 'latest', label: 'Oscilloscope Latest',
      description: 'Most-recent sample written to the scope buffer. Tracks the scoped signal at frame rate.',
      range: 'bipolar' },
    { id: 'mean', label: 'Oscilloscope Mean',
      description: 'Running mean of the visible scope window. Useful for envelope-following arbitrary signals.',
      range: 'bipolar' },
    { id: 'peak', label: 'Oscilloscope Peak',
      description: 'Peak absolute sample in the visible scope window (0..1). Like a fast-attack envelope follower.',
      range: 'unipolar' },
    { id: 'trigger', label: 'Oscilloscope Trigger',
      description: 'One-frame pulse (1.0) when a rising-edge trigger crossing was detected this frame; else 0.',
      range: 'unipolar' },
  ],
  compute: (f) => {
    if (!f.scope) return { latest: 0, mean: 0, peak: 0, trigger: 0 };
    // Non-allocating read; we only iterate, never mutate.
    const arr = f.scope.peekOutWindow();
    let sum = 0, peak = 0;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      sum += v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const mean = n > 0 ? sum / n : 0;
    return {
      latest:  f.scope.getLatestSample(),
      mean,
      peak,
      trigger: f.triggerHit ? 1 : 0,
    };
  },
};

// =====================================================================
// Registry — single map of every pattern
// =====================================================================

export const PATTERN_REGISTRY: Record<PatternKind, PatternDef> = {
  solid:          SOLID_DEF,
  gradient:       GRADIENT_DEF,
  bars:           BARS_DEF,
  grid:           GRID_DEF,
  checker:        CHECKER_DEF,
  sineBands:      SINE_BANDS_DEF,
  triangleBands:  TRIANGLE_BANDS_DEF,
  sawBands:       SAW_BANDS_DEF,
  squareBands:    SQUARE_BANDS_DEF,
  pulseBands:     PULSE_BANDS_DEF,
  lissajous:      LISSAJOUS_DEF,
  spiral:         SPIRAL_DEF,
  whiteNoise:     WHITE_NOISE_DEF,
  perlinNoise:    PERLIN_NOISE_DEF,
  worleyNoise:    WORLEY_NOISE_DEF,
  oscilloscope:   OSCILLOSCOPE_DEF,
};

/** All pattern kinds in display order (calibration → waveform → noise → oscilloscope). */
export const PATTERN_ORDER: readonly PatternKind[] = [
  'solid', 'gradient', 'bars', 'grid', 'checker',
  'sineBands', 'triangleBands', 'sawBands', 'squareBands', 'pulseBands',
  'lissajous', 'spiral',
  'whiteNoise', 'perlinNoise', 'worleyNoise',
  'oscilloscope',
];

/** Group label by category — used by the UI dropdown to render
 *  `<optgroup>` headers and by the about-page Pattern Catalog. */
export const PATTERN_CATEGORY_LABEL: Record<PatternCategory, string> = {
  calibration:  'Calibration',
  waveform:     'Waveform',
  noise:        'Noise',
  oscilloscope: 'Oscilloscope',
};

export function getPatternDef(kind: PatternKind): PatternDef {
  return PATTERN_REGISTRY[kind];
}

/**
 * Flat enumeration of every output every pattern publishes, keyed by
 * the bus id (`<patternKind>:<signalId>`). UI pickers (Classic source
 * dropdown, graph node param menu, CV-output channel source picker)
 * iterate this. Stable order: PATTERN_ORDER × def.outputs order.
 */
export interface PatternOutputEntry {
  /** Fully-qualified bus id, e.g. `'lissajous:x'`. */
  busId: string;
  patternKind: PatternKind;
  patternLabel: string;
  signal: PatternOutputDef;
}

export function listPatternOutputs(): readonly PatternOutputEntry[] {
  const out: PatternOutputEntry[] = [];
  for (const kind of PATTERN_ORDER) {
    const def = PATTERN_REGISTRY[kind];
    if (!def.outputs) continue;
    for (const sig of def.outputs) {
      out.push({
        busId: `${kind}:${sig.id}`,
        patternKind: kind,
        patternLabel: def.label,
        signal: sig,
      });
    }
  }
  return out;
}

/**
 * Numeric blend-mode index used by the compositor fragment shader's
 * `uBlendMode` int uniform. Keep in sync with `PatternBlendMode` order
 * in `compositor.frag.glsl`.
 */
export const BLEND_MODE_INDEX: Record<import('../../state/Settings').PatternBlendMode, number> = {
  replace:    0,
  add:        1,
  subtract:   2,
  multiply:   3,
  screen:     4,
  difference: 5,
  mask:       6,
  crossfade:  7,
};
