/**
 * Settings keys that are routable from MIDI / OSC / modulation slots.
 *
 * Centralized so the modulation section, MIDI learn table, and OSC learn
 * table all share the same labels in their dropdowns.
 */

import { ModTarget } from '../state/Settings';

export interface TargetOption {
  v: ModTarget;
  l: string;
}

export const TARGETS: TargetOption[] = [
  { v: 'hPos', l: 'H Position' }, { v: 'vPos', l: 'V Position' },
  { v: 'hSize', l: 'H Size' },    { v: 'vSize', l: 'V Size' },
  { v: 'aspect', l: 'Aspect' },
  { v: 'zPush', l: 'Z Push' },    { v: 'zBias', l: 'Z Bias' },
  { v: 'intensity', l: 'Intensity' }, { v: 'focus', l: 'Focus' },
  { v: 'hCenter', l: 'H Center' }, { v: 'vCenter', l: 'V Center' },
  { v: 'hSpin', l: 'H Spin' },     { v: 'vSpin', l: 'V Spin' },
  { v: 'hLinearity', l: 'H Linearity' }, { v: 'vLinearity', l: 'V Linearity' },
  { v: 'skip', l: 'Skip' },
  { v: 'threshold', l: 'Threshold' }, { v: 'contrast', l: 'Contrast' }, { v: 'gamma', l: 'Gamma' },
  { v: 'bloomIntensity', l: 'Bloom Intensity' }, { v: 'bloomRadius', l: 'Bloom Radius' },
  { v: 'scanlineIntensity', l: 'Scanline Intensity' },
  { v: 'chromaAmount', l: 'Chroma Amount' },
  { v: 'feedbackDecay', l: 'Feedback Decay' },
  { v: 'cameraFov', l: 'Camera FOV' },
  // I/O routing-friendly targets (audio-driven)
  { v: 'audioGain', l: 'Audio Gain' },
  { v: 'audioFloor', l: 'Audio Floor' },
  { v: 'beatSensitivity', l: 'Beat Sensitivity' },
  { v: 'spectrumAmount', l: 'Spectrum Amount' },
  { v: 'spectrumStride', l: 'Spectrum Stride' },
];

/** Same list, in `{ value, label }` shape for the LearnBinding widget. */
export const TARGET_OPTIONS = TARGETS.map((t) => ({ value: t.v as string, label: t.l }));
