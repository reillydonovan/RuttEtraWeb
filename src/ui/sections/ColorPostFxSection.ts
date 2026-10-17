/**
 * Color & post-processing controls.
 */

import { SettingsStore, DEFAULTS, type Settings } from '../../state/Settings';
import { row, group, slider, toggle, dropdown, colorInput, button } from '../widgets';

/** Every key each group owns — the per-group Reset and the section-wide Reset both read this. */
const GROUP_KEYS = {
  color:    ['colorMode', 'customTint', 'backgroundColor'],
  bloom:    ['bloomEnabled', 'bloomIntensity', 'bloomRadius', 'bloomThreshold'],
  scan:     ['scanlineEnabled', 'scanlineIntensity', 'scanlineDensity'],
  chroma:   ['chromaEnabled', 'chromaAmount'],
  vignette: ['vignetteEnabled', 'vignetteAmount'],
  fb:       ['feedbackEnabled', 'feedbackDecay', 'feedbackShape', 'feedbackShapeX', 'feedbackShapeY', 'feedbackShapeRadius', 'feedbackShapeSoftness'],
  analog:   ['analogEnabled', 'analogNoise', 'analogDropout', 'analogHum'],
} satisfies Record<string, (keyof Settings)[]>;

/** Base values back to the shipped defaults (modulation keeps layering on top). */
function resetKeys(settings: SettingsStore, keys: readonly (keyof Settings)[]): void {
  const patch: Partial<Settings> = {};
  for (const k of keys) (patch as Record<string, unknown>)[k] = DEFAULTS[k];
  settings.patch(patch);
}

export function createColorPostFxSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');
  const resetRow = (label: string, keys: readonly (keyof Settings)[]): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'rw-btn-row';
    r.appendChild(button(label, () => resetKeys(settings, keys)));
    return r;
  };

  const color = group('Color');
  color.body.append(
    row('Mode', dropdown(settings, 'colorMode', [
      { value: 'grayscale',      label: 'Grayscale' },
      { value: 'phosphorGreen',  label: 'Phosphor Green (P1)' },
      { value: 'phosphorAmber',  label: 'Phosphor Amber' },
      { value: 'phosphorCustom', label: 'Custom Tint' },
      { value: 'video',          label: 'Sampled Video' },
    ])),
    row('Tint',       colorInput(settings, 'customTint')),
    row('Background', colorInput(settings, 'backgroundColor')),
  );
  color.body.appendChild(resetRow('Reset Color', GROUP_KEYS.color));
  root.appendChild(color.root);

  const bloom = group('Bloom (Phosphor Glow)');
  bloom.body.append(
    row('Bloom',     toggle(settings, 'bloomEnabled')),
    row('Intensity', slider(settings, 'bloomIntensity', 0, 3, 0.001)),
    row('Radius',    slider(settings, 'bloomRadius',    0, 2, 0.001)),
    row('Threshold', slider(settings, 'bloomThreshold', 0, 1, 0.001)),
  );
  bloom.body.appendChild(resetRow('Reset Bloom', GROUP_KEYS.bloom));
  root.appendChild(bloom.root);

  const scan = group('Scanline Overlay');
  scan.body.append(
    row('Scanlines', toggle(settings, 'scanlineEnabled')),
    row('Intensity', slider(settings, 'scanlineIntensity', 0, 1, 0.001)),
    row('Density',   slider(settings, 'scanlineDensity',   100, 2000, 1)),
  );
  scan.body.appendChild(resetRow('Reset Scanlines', GROUP_KEYS.scan));
  root.appendChild(scan.root);

  const chroma = group('Chromatic Aberration');
  chroma.body.append(
    row('Chroma', toggle(settings, 'chromaEnabled')),
    row('Amount', slider(settings, 'chromaAmount', 0, 0.02, 0.0001)),
  );
  chroma.body.appendChild(resetRow('Reset Chroma', GROUP_KEYS.chroma));
  root.appendChild(chroma.root);

  const vignette = group('Vignette');
  vignette.body.append(
    row('Vignette', toggle(settings, 'vignetteEnabled')),
    row('Amount',   slider(settings, 'vignetteAmount', 0, 1, 0.001)),
  );
  vignette.body.appendChild(resetRow('Reset Vignette', GROUP_KEYS.vignette));
  root.appendChild(vignette.root);

  const fb = group('Burn-In Feedback');
  fb.body.append(
    row('Feedback', toggle(settings, 'feedbackEnabled', 'long-exposure trails')),
    row('Decay',    slider(settings, 'feedbackDecay', 0.5, 0.999, 0.001), '0.9≈0.1s · 0.99≈1s · 0.999≈11s'),
    row('Shape', dropdown(settings, 'feedbackShape', [
      { value: 'full', label: 'Full frame' },
      { value: 'circle', label: 'Circle' },
      { value: 'box', label: 'Box' },
    ])),
    row('Shape X',  slider(settings, 'feedbackShapeX', 0, 1, 0.001)),
    row('Shape Y',  slider(settings, 'feedbackShapeY', 0, 1, 0.001)),
    row('Radius',   slider(settings, 'feedbackShapeRadius', 0.05, 0.8, 0.001)),
    row('Softness', slider(settings, 'feedbackShapeSoftness', 0, 0.5, 0.001)),
  );
  fb.body.appendChild(resetRow('Reset Feedback', GROUP_KEYS.fb));
  root.appendChild(fb.root);

  const analog = group('Analog Character');
  analog.body.append(
    row('Analog',  toggle(settings, 'analogEnabled', 'grain / dropout / hum')),
    row('Noise',   slider(settings, 'analogNoise', 0, 1, 0.001)),
    row('Dropout', slider(settings, 'analogDropout', 0, 1, 0.001)),
    row('Hum Bar', slider(settings, 'analogHum', 0, 1, 0.001)),
  );
  analog.body.appendChild(resetRow('Reset Analog', GROUP_KEYS.analog));
  root.appendChild(analog.root);

  // The whole section at once — colour and every post effect back to their defaults.
  root.appendChild(resetRow('Reset Color / Post FX', Object.values(GROUP_KEYS).flat()));

  return root;
}
