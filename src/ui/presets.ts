/**
 * Built-in presets — each is a partial Settings dictionary applied via
 * `settings.replaceAll(...)`. Source-related fields are intentionally
 * omitted so loading a preset doesn't disrupt the active video source.
 */

import { DEFAULTS, type Settings } from '../state/Settings';

export interface Preset {
  id: string;
  name: string;
  description: string;
  values: Partial<Settings>;
}

const LOOKS: Preset[] = [
  {
    id: 'classic-1974',
    name: 'Classic 1974',
    description: 'White scan lines on black, modest bloom — the original look.',
    values: {
      colorMode: 'grayscale',
      backgroundColor: '#000000',
      zPush: 1.1, zBias: 0, zInvert: false,
      threshold: 0.06, contrast: 1.1, gamma: 1.0,
      intensity: 1.0, focus: 0.0,
      hSize: 1, vSize: 1, aspect: 4 / 3,
      hLinearity: 0.05, vLinearity: 0.05,
      bloomEnabled: true, bloomIntensity: 0.4, bloomRadius: 0.4, bloomThreshold: 0.2,
      scanlineEnabled: true, scanlineIntensity: 0.1, scanlineDensity: 600,
      chromaEnabled: false,
      vignetteEnabled: true, vignetteAmount: 0.4,
      feedbackEnabled: false,
    },
  },
  {
    id: 'phosphor-green',
    name: 'Phosphor Green',
    description: 'P1 phosphor look — soft green glow, heavy bloom.',
    values: {
      colorMode: 'phosphorGreen',
      backgroundColor: '#02100a',
      zPush: 0.9, intensity: 1.1, focus: 0.15,
      bloomEnabled: true, bloomIntensity: 1.2, bloomRadius: 0.8, bloomThreshold: 0.05,
      scanlineEnabled: true, scanlineIntensity: 0.22, scanlineDensity: 720,
      chromaEnabled: true, chromaAmount: 0.002,
      vignetteEnabled: true, vignetteAmount: 0.6,
    },
  },
  {
    id: 'amber-terminal',
    name: 'Amber Terminal',
    description: 'Warm amber phosphor with a heavier scanline grid.',
    values: {
      colorMode: 'phosphorAmber',
      backgroundColor: '#0c0703',
      zPush: 0.7, intensity: 1.0, focus: 0.1,
      bloomEnabled: true, bloomIntensity: 0.95, bloomRadius: 0.7, bloomThreshold: 0.1,
      scanlineEnabled: true, scanlineIntensity: 0.3, scanlineDensity: 540,
      chromaEnabled: true, chromaAmount: 0.0035,
      vignetteEnabled: true, vignetteAmount: 0.7,
    },
  },
  {
    id: 'sampled-video',
    name: 'Sampled Video',
    description: 'Scan lines keep the colours of the picture they trace, with a soft glow.',
    values: {
      colorMode: 'video',
      backgroundColor: '#000000',
      zPush: 0.9, zBias: 0,
      threshold: 0.04, contrast: 1.1, gamma: 1.0,
      intensity: 1.15, focus: 0.05,
      bloomEnabled: true, bloomIntensity: 0.6, bloomRadius: 0.5, bloomThreshold: 0.15,
      scanlineEnabled: true, scanlineIntensity: 0.12, scanlineDensity: 640,
      chromaEnabled: false,
      vignetteEnabled: true, vignetteAmount: 0.45,
      feedbackEnabled: false,
      renderMode: 'scanlines',
    },
  },
  {
    id: 'wireframe',
    name: 'Wireframe',
    description: 'Sampled video color with no bloom — readable wireframe terrain.',
    values: {
      colorMode: 'video',
      backgroundColor: '#000000',
      zPush: 1.4, zBias: 0,
      threshold: 0.0, contrast: 1.0, gamma: 1.0,
      intensity: 1.2, focus: 0.0,
      bloomEnabled: false,
      scanlineEnabled: false,
      chromaEnabled: false,
      vignetteEnabled: false,
      feedbackEnabled: false,
      renderMode: 'wireframe',
      scanRate: 180, cols: 240,
    },
  },
  {
    id: 'heavy-bloom',
    name: 'Heavy Bloom',
    description: 'Deep haze, high contrast, dramatic glow.',
    values: {
      colorMode: 'phosphorCustom',
      customTint: '#9fffe0',
      backgroundColor: '#02060a',
      zPush: 1.6, threshold: 0.12, contrast: 1.5, gamma: 0.9,
      intensity: 1.4, focus: 0.25,
      bloomEnabled: true, bloomIntensity: 2.2, bloomRadius: 1.2, bloomThreshold: 0.0,
      scanlineEnabled: true, scanlineIntensity: 0.18, scanlineDensity: 800,
      chromaEnabled: true, chromaAmount: 0.0055,
      vignetteEnabled: true, vignetteAmount: 0.75,
    },
  },
  {
    id: 'burn-in',
    name: 'Burn-In',
    description: 'Long-exposure feedback trails like an aging CRT.',
    values: {
      colorMode: 'phosphorGreen',
      backgroundColor: '#000000',
      zPush: 0.9, intensity: 1.0, focus: 0.05,
      bloomEnabled: true, bloomIntensity: 0.8, bloomRadius: 0.5, bloomThreshold: 0.1,
      scanlineEnabled: true, scanlineIntensity: 0.18, scanlineDensity: 720,
      chromaEnabled: true, chromaAmount: 0.0025,
      vignetteEnabled: true, vignetteAmount: 0.6,
      feedbackEnabled: true, feedbackDecay: 0.94,
    },
  },
  {
    id: 'diving',
    name: 'Diving',
    description: 'Camera tucked low and inside the raster — fly-through view.',
    values: {
      colorMode: 'phosphorGreen',
      backgroundColor: '#000000',
      zPush: 1.4, intensity: 1.2,
      bloomEnabled: true, bloomIntensity: 1.0, bloomRadius: 0.7,
      scanlineEnabled: true, scanlineIntensity: 0.18,
      chromaEnabled: true, chromaAmount: 0.003,
      vignetteEnabled: true, vignetteAmount: 0.55,
      cameraMode: 'fly',
      cameraFov: 80,
      cameraNear: 0.005, cameraFar: 100,
      defaultView: {
        posX: -0.6, posY: 0.05, posZ: 0.4,
        targetX: 0, targetY: 0.1, targetZ: 0,
        upX: 0, upY: 1, upZ: 0,
        fov: 80,
      },
    },
  },

  // ---- No-camera presets ----------------------------------------------
  // Each turns on the Pattern Generator (replace blend, full mix) with a
  // pattern that moves on its own, so the instrument shows a live image
  // with no camera, microphone or file — the boot overlay's PATTERN
  // button loads the first of these. Pattern values follow the kind's
  // registry defaults with small tweaks.
  {
    id: 'pattern-terrain',
    name: 'Noise Terrain',
    description: 'No camera needed — slowly drifting Perlin noise read as a phosphor landscape.',
    values: {
      patternEnabled: true, patternKind: 'perlinNoise', patternBlendMode: 'replace', patternMix: 1,
      patternBrightness: 0.75, patternContrast: 1.3, patternScale: 3.0, patternOctaves: 4,
      colorMode: 'phosphorGreen',
      backgroundColor: '#000000',
      zPush: 1.4, intensity: 0.85, focus: 0.1,
      bloomEnabled: true, bloomIntensity: 0.5, bloomRadius: 0.5, bloomThreshold: 0.3,
      scanlineEnabled: true, scanlineIntensity: 0.15,
      vignetteEnabled: true, vignetteAmount: 0.5,
    },
  },
  {
    id: 'pattern-lissajous',
    name: 'Lissajous Scope',
    description: 'No camera needed — a moving two-oscillator trace pushed into depth.',
    values: {
      patternEnabled: true, patternKind: 'lissajous', patternBlendMode: 'replace', patternMix: 1,
      patternBrightness: 1.0, patternFrequency: 3, patternFreqRatio: 2,
      patternPhaseOffset: Math.PI / 2, patternThickness: 0.02,
      colorMode: 'phosphorGreen',
      backgroundColor: '#02100a',
      zPush: 1.0, intensity: 1.2,
      bloomEnabled: true, bloomIntensity: 1.2, bloomRadius: 0.8, bloomThreshold: 0.05,
      scanlineEnabled: true, scanlineIntensity: 0.2,
      vignetteEnabled: true, vignetteAmount: 0.55,
    },
  },
  {
    id: 'pattern-cells',
    name: 'Worley Cells',
    description: 'No camera needed — shifting cellular terrain in amber.',
    values: {
      patternEnabled: true, patternKind: 'worleyNoise', patternBlendMode: 'replace', patternMix: 1,
      patternBrightness: 0.9, patternContrast: 1.2, patternScale: 1.0, patternPointDensity: 8,
      colorMode: 'phosphorAmber',
      backgroundColor: '#0c0703',
      zPush: 1.2, intensity: 1.0,
      bloomEnabled: true, bloomIntensity: 0.95, bloomRadius: 0.7, bloomThreshold: 0.1,
      scanlineEnabled: true, scanlineIntensity: 0.25,
      vignetteEnabled: true, vignetteAmount: 0.6,
    },
  },
];

/** Keys a "look" owns: everything any built-in look sets, minus the Pattern Generator
 *  (pressing Default must never switch off the picture currently on screen). */
const LOOK_KEYS = [...new Set(LOOKS.flatMap((p) => Object.keys(p.values)))]
  .filter((k) => !k.startsWith('pattern')) as (keyof Settings)[];

/** "Default": every look key back to the factory value — a reset, applied like any preset
 *  (only these keys, so bindings, the patch, layout and sources are untouched). */
const DEFAULT_LOOK: Preset = {
  id: 'default',
  name: 'Default',
  description: 'Back to the factory look: every colour, depth, bloom and post-FX setting the other presets change, at its default.',
  values: Object.fromEntries(LOOK_KEYS.map((k) => [k, DEFAULTS[k]])) as Partial<Settings>,
};

export const PRESETS: Preset[] = [DEFAULT_LOOK, ...LOOKS];

/** The preset the boot overlay's PATTERN button starts with. */
export const NO_CAMERA_PRESET_ID = 'pattern-terrain';
