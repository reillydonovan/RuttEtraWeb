/**
 * Settings keys that are routable from MIDI / OSC / modulation slots.
 *
 * Centralized so the modulation section, MIDI learn table, and OSC learn
 * table all share the same labels in their dropdowns.
 *
 * The `cv:<n>` virtual targets (CV-output channels) are NOT included in
 * the static list — they're appended by `cvOutputTargets()` from the
 * user's current `Settings.cvOutputChannels` because the count and
 * labels of CV outputs are user-editable. ModulationSection +
 * BeginnerView call that helper at dropdown-build time.
 */

import { CVOutputChannel, ModTarget, SettingsStore } from '../state/Settings';

export interface TargetOption {
  v: ModTarget | 'none';
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
  // Pattern Generator (v10) — synthesized "video signal" layer params.
  // Modulating these is how the Pattern Generator becomes a true musical
  // oscillator: an LFO swept across `patternFrequency` makes sine bands
  // breathe, an audio envelope on `patternBrightness` flashes a checker,
  // a clock on `patternMix` chops the layer in/out at tempo.
  { v: 'patternMix',          l: 'Pattern: Mix' },
  { v: 'patternBrightness',   l: 'Pattern: Brightness' },
  { v: 'patternContrast',     l: 'Pattern: Contrast' },
  { v: 'patternFrequency',    l: 'Pattern: Frequency' },
  { v: 'patternPhase',        l: 'Pattern: Phase' },
  { v: 'patternScale',        l: 'Pattern: Scale' },
  { v: 'patternThickness',    l: 'Pattern: Thickness' },
  { v: 'patternDensity',      l: 'Pattern: Density' },
  { v: 'patternFreqRatio',    l: 'Pattern: Freq Ratio' },
  { v: 'patternPhaseOffset',  l: 'Pattern: Phase Offset' },
  { v: 'patternArms',         l: 'Pattern: Arms' },
  { v: 'patternOctaves',      l: 'Pattern: Octaves' },
  { v: 'patternPointDensity', l: 'Pattern: Point Density' },
  { v: 'patternScopeSweep',     l: 'Pattern: Scope Sweep' },
  { v: 'patternScopeTrigger',   l: 'Pattern: Scope Trigger' },
  { v: 'patternScopePersist',   l: 'Pattern: Scope Persist' },
  { v: 'patternScopeThickness', l: 'Pattern: Scope Thickness' },
];

/** Same list, in `{ value, label }` shape for the LearnBinding widget. */
export const TARGET_OPTIONS = TARGETS.map((t) => ({ value: t.v as string, label: t.l }));

/**
 * Build dropdown entries for every configured CV-output channel,
 * formatted as `cv:<channelIndex>` so ModMatrix / GraphEngine can
 * detect them by prefix. Called by the modulation UI at
 * dropdown-build time so adding a new channel in the I/O panel
 * shows up everywhere targets are picked.
 */
export function cvOutputTargets(settings: SettingsStore): TargetOption[] {
  const channels: CVOutputChannel[] = settings.get('cvOutputChannels');
  return channels.map((ch) => ({
    v: `cv:${ch.channelIndex}` as ModTarget,
    l: `CV Out: Ch ${ch.channelIndex + 1}${ch.label ? ` (${ch.label})` : ''} — ${ch.type}`,
  }));
}
