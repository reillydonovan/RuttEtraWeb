/**
 * Built-in presets — each is a partial Settings dictionary applied via
 * `settings.replaceAll(...)`. Source-related fields are intentionally
 * omitted so loading a preset doesn't disrupt the active video source.
 */

import { Settings } from '../state/Settings';

export interface Preset {
  id: string;
  name: string;
  description: string;
  values: Partial<Settings>;
}

export const PRESETS: Preset[] = [
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
];
